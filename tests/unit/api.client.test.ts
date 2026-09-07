import { describe, it, expect, vi, beforeEach } from 'vitest';

import { apiClient } from '$lib/services/api';
import { ContractBoundaryError } from '$lib/services/contract-boundary';

describe('ApiClient', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('parses successful JSON responses', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve(JSON.stringify({ data: { x: 1 }, message: 'ok' }))
			} as unknown as Response)
		);

		const res = await apiClient.get('/test', 'envelope');
		expect(res.success).toBe(true);
		// data should be the inner data object
		// @ts-ignore
		expect(res.data.x).toBe(1);
	});

	it('keeps an envelope message without treating the envelope as payload data', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve(JSON.stringify({ status: 200, message: 'Login successful' }))
			} as unknown as Response)
		);

		const res = await apiClient.post<void>(
			'/user/login',
			{
				email: 'ada@example.com',
				password: 'secret'
			},
			'envelope'
		);

		expect(res).toMatchObject({ success: true, message: 'Login successful' });
		expect(res.data).toBeUndefined();
	});

	it('rejects raw non-envelope object as contract error (strict envelope)', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve(JSON.stringify({ id: 'user-1', username: 'ada' }))
			} as unknown as Response)
		);

		await expect(
			apiClient.get<{ id: string; username: string }>('/user/me', 'envelope')
		).rejects.toBeInstanceOf(ContractBoundaryError);
	});

	it('keeps raw payload collisions solely inside data when wrapped in envelope', async () => {
		const payload = {
			success: false,
			value: 1,
			pagination: { total: 1, limit: 10, offset: 0, hasMore: false }
		};
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve(JSON.stringify({ data: payload }))
			} as unknown as Response)
		);

		const res = await apiClient.get<typeof payload>('/raw-collision', 'envelope');

		expect(res.success).toBe(true);
		expect(res.data).toEqual(payload);
		expect(res).not.toHaveProperty('value');
		expect(res).not.toHaveProperty('pagination');
	});

	it('protects fixed envelope fields while preserving explicit metadata', async () => {
		const data = { success: false, data: 'nested', message: 'payload message' };
		const pagination = { total: 1, limit: 10, offset: 0, hasMore: false };
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () =>
					Promise.resolve(
						JSON.stringify({
							status: 200,
							success: false,
							message: 'Envelope message',
							data,
							pagination
						})
					)
			} as unknown as Response)
		);

		const res = await apiClient.get<typeof data, { pagination: typeof pagination }>(
			'/envelope-collision',
			'envelope'
		);

		expect(res.success).toBe(true);
		expect(res.data).toEqual(data);
		expect(res.message).toBe('Envelope message');
		expect(res.pagination).toEqual(pagination);
	});

	it('exposes response metadata alongside the unwrapped payload', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () =>
					Promise.resolve(
						JSON.stringify({
							status: 200,
							data: [],
							pagination: { total: 0, limit: 50, offset: 0, hasMore: false }
						})
					)
			} as unknown as Response)
		);

		const res = await apiClient.get<
			unknown[],
			{ pagination: { total: number; limit: number; offset: number; hasMore: boolean } }
		>('/chat/get/user-1', 'envelope');

		expect(res.data).toEqual([]);
		expect(res.pagination).toEqual({ total: 0, limit: 50, offset: 0, hasMore: false });
	});

	it('rejects successful non-JSON in envelope mode', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve('not-json')
			} as unknown as Response)
		);

		await expect(apiClient.get('/text', 'envelope')).rejects.toBeInstanceOf(ContractBoundaryError);
	});

	it('preserves successful raw text through explicit raw mode', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve('plain text')
			} as unknown as Response)
		);
		const res = await apiClient.request<string>('/text', { method: 'GET', responseMode: 'raw' });
		expect(res.data).toBe('plain text');
	});

	it('preserves empty raw text', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve('')
			} as unknown as Response)
		);
		const res = await apiClient.request<string>('/empty', { method: 'GET', responseMode: 'raw' });
		expect(res.data).toBe('');
	});

	it('returns raw JSON as exact text not parsed', async () => {
		const jsonText = JSON.stringify({ id: 1, name: 'test' });
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve(jsonText)
			} as unknown as Response)
		);
		const res = await apiClient.request<string>('/json', { method: 'GET', responseMode: 'raw' });
		expect(res.data).toBe(jsonText);
		expect(typeof res.data).toBe('string');
	});

	it('rejects inherited envelope keys', async () => {
		const payload = Object.create({ data: 'inherited' });
		payload.value = 'payload';
		const json = JSON.stringify(payload); // only own value
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve(json)
			} as unknown as Response)
		);
		await expect(apiClient.get('/payload', 'envelope')).rejects.toBeInstanceOf(
			ContractBoundaryError
		);
	});

	it('rejects missing envelope keys', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve(JSON.stringify({ value: 1 }))
			} as unknown as Response)
		);
		await expect(apiClient.get('/missing-keys', 'envelope')).rejects.toBeInstanceOf(
			ContractBoundaryError
		);
	});

	it('throws ApiClientError on non-ok responses with message', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: false,
				status: 400,
				text: () => Promise.resolve(JSON.stringify({ message: 'bad' }))
			} as unknown as Response)
		);

		await expect(apiClient.get('/bad', 'envelope')).rejects.toMatchObject({
			message: 'bad',
			status: 400
		});
	});

	it('reports invalid JSON on failed malformed JSON', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: false,
				status: 500,
				text: () => Promise.resolve('not-json')
			} as unknown as Response)
		);
		await expect(apiClient.get('/bad-json', 'envelope')).rejects.toMatchObject({
			status: 500,
			message: expect.stringContaining('Invalid JSON')
		});
	});

	it('preserves failed raw text and status', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: false,
				status: 400,
				text: () => Promise.resolve('raw error text')
			} as unknown as Response)
		);
		await expect(
			apiClient.request('/raw-fail', { method: 'GET', responseMode: 'raw' })
		).rejects.toMatchObject({ status: 400, message: 'raw error text' });
	});

	it('uses Request failed for empty failed raw body', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: false,
				status: 500,
				text: () => Promise.resolve('')
			} as unknown as Response)
		);
		await expect(
			apiClient.request('/empty-fail', { method: 'GET', responseMode: 'raw' })
		).rejects.toMatchObject({ status: 500, message: 'Request failed' });
	});

	it('converts AbortError to cancelled ApiClientError', async () => {
		const e = new Error('ab');
		e.name = 'AbortError';
		globalThis.fetch = vi.fn(() => Promise.reject(e));

		await expect(apiClient.get('/abort', 'envelope')).rejects.toMatchObject({
			message: 'Request cancelled'
		});
	});

	it('wraps other errors as network errors', async () => {
		globalThis.fetch = vi.fn(() => Promise.reject(new Error('boom')));

		await expect(apiClient.get('/net', 'envelope')).rejects.toMatchObject({
			message: 'Network error. Please check your connection.'
		});
	});

	it('preserves ContractBoundaryError instead of converting to network error', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve('not-json')
			} as unknown as Response)
		);
		await expect(apiClient.get('/boundary', 'envelope')).rejects.toBeInstanceOf(
			ContractBoundaryError
		);
	});
});
