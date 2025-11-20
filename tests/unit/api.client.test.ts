import { describe, it, expect, vi, beforeEach } from 'vitest';

import { apiClient } from '$lib/services/api';

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

		const res = await apiClient.get('/test');
		expect(res.success).toBe(true);
		// data should be the inner data object
		// @ts-ignore
		expect(res.data.x).toBe(1);
	});

	it('handles non-JSON response bodies gracefully', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				text: () => Promise.resolve('not-json')
			} as unknown as Response)
		);

		const res = await apiClient.get('/text');
		expect(res.success).toBe(true);
		expect(res.data).toBeDefined();
	});

	it('throws ApiClientError on non-ok responses with message', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				ok: false,
				status: 400,
				text: () => Promise.resolve(JSON.stringify({ message: 'bad' }))
			} as unknown as Response)
		);

		await expect(apiClient.get('/bad')).rejects.toMatchObject({
			message: 'bad',
			status: 400
		});
	});

	it('converts AbortError to cancelled ApiClientError', async () => {
		const e = new Error('ab');
		e.name = 'AbortError';
		globalThis.fetch = vi.fn(() => Promise.reject(e));

		await expect(apiClient.get('/abort')).rejects.toMatchObject({ message: 'Request cancelled' });
	});

	it('wraps other errors as network errors', async () => {
		globalThis.fetch = vi.fn(() => Promise.reject(new Error('boom')));

		await expect(apiClient.get('/net')).rejects.toMatchObject({
			message: 'Network error. Please check your connection.'
		});
	});
});
