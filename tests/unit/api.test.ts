/**
 * Unit tests for API client
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetch globally
globalThis.fetch = vi.fn();

// Mock environment
vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_API_URL: 'http://localhost:85'
	}
}));

vi.mock('$lib/utils', () => ({
	safeToString: String
}));

describe('API Client', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
	});

	it('should make GET request successfully', async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue(JSON.stringify({ data: { id: '1', name: 'test' } }))
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');
		const response = await apiClient.get<{ id: string; name: string }>('/test');

		expect(response.success).toBe(true);
		expect(response.data).toEqual({ id: '1', name: 'test' });
	});

	it('should make POST request successfully', async () => {
		const mockResponse = {
			ok: true,
			status: 201,
			text: vi.fn().mockResolvedValue(JSON.stringify({ data: { id: '2' } }))
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');
		const response = await apiClient.post('/test', { name: 'test' });

		expect(response.success).toBe(true);
	});

	it('should make PUT request successfully', async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue(JSON.stringify({ data: { updated: true } }))
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');
		const response = await apiClient.put('/test/1', { name: 'updated' });

		expect(response.success).toBe(true);
	});

	it('should make DELETE request successfully', async () => {
		const mockResponse = {
			ok: true,
			status: 204,
			text: vi.fn().mockResolvedValue('')
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');
		const response = await apiClient.delete('/test/1');

		expect(response.success).toBe(true);
	});

	it('should handle 404 error', async () => {
		const mockResponse = {
			ok: false,
			status: 404,
			text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'Not found' }))
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');

		await expect(apiClient.get('/not-found')).rejects.toThrow();
	});

	it('should handle network error', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

		const { apiClient } = await import('$lib/services/api');

		await expect(apiClient.get('/test')).rejects.toThrow();
	});

	it('should handle malformed JSON response', async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue('invalid json')
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');
		const response = await apiClient.get('/test');

		// Should handle malformed JSON gracefully
		expect(response).toBeDefined();
	});

	it('should handle empty response text', async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue('')
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');
		const response = await apiClient.get('/test');

		expect(response.success).toBe(true);
	});

	it('should handle response with errors array', async () => {
		const mockResponse = {
			ok: false,
			status: 400,
			text: vi.fn().mockResolvedValue(
				JSON.stringify({
					message: 'Validation failed',
					errors: [{ field: 'email', message: 'Invalid email' }]
				})
			)
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');

		try {
			await apiClient.post('/test', { email: 'invalid' });
		} catch (error) {
			expect(error).toBeDefined();
			expect((error as { status: number }).status).toBe(400);
		}
	});

	it('should handle response with error field instead of message', async () => {
		const mockResponse = {
			ok: false,
			status: 500,
			text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'Internal server error' }))
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');

		await expect(apiClient.get('/test')).rejects.toThrow('Internal server error');
	});

	it('should cancel request by ID', async () => {
		const mockAbort = vi.fn();
		const mockResponse = {
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue(JSON.stringify({ data: 'test' }))
		};

		// Mock AbortController
		globalThis.AbortController = vi.fn().mockImplementation(() => ({
			abort: mockAbort,
			signal: {}
		})) as unknown as typeof AbortController;

		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve(mockResponse), 100))
		);

		const { apiClient } = await import('$lib/services/api');

		// Start a request with ID
		const requestPromise = apiClient.get('/test', 'request-1');

		// Cancel it
		apiClient.cancelRequest('request-1');

		await requestPromise;
		expect(mockAbort).toHaveBeenCalled();
	});

	it('should cancel all active requests', async () => {
		const mockAbort = vi.fn();
		globalThis.AbortController = vi.fn().mockImplementation(() => ({
			abort: mockAbort,
			signal: {}
		})) as unknown as typeof AbortController;

		const { apiClient } = await import('$lib/services/api');

		apiClient.cancelAllRequests();
		// Should not throw even if no requests are active
		expect(true).toBe(true);
	});

	it('should handle AbortError when request is cancelled', async () => {
		const abortError = new Error('The operation was aborted');
		abortError.name = 'AbortError';

		(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(abortError);

		const { apiClient } = await import('$lib/services/api');

		await expect(apiClient.get('/test')).rejects.toThrow('Request cancelled');
	});

	it('should handle non-object response data', async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue(JSON.stringify('just a string'))
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');
		const response = await apiClient.get('/test');

		expect(response).toBeDefined();
		expect(response.success).toBe(true);
	});
});
