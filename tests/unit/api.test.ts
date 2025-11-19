/**
 * Unit tests for API client
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock environment
vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_API_URL: 'http://localhost:85'
	}
}));

vi.mock('$lib/utils', () => ({
	safeToString: (val: unknown) => String(val)
}));

describe('API Client', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockReset();
	});

	it('should make GET request successfully', async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue(JSON.stringify({ data: { id: '1', name: 'test' } }))
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

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
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

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
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

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
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

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
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');

		await expect(apiClient.get('/not-found')).rejects.toThrow();
	});

	it('should handle network error', async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

		const { apiClient } = await import('$lib/services/api');

		await expect(apiClient.get('/test')).rejects.toThrow();
	});

	it('should handle malformed JSON response', async () => {
		const mockResponse = {
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue('invalid json')
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

		const { apiClient } = await import('$lib/services/api');
		const response = await apiClient.get('/test');

		// Should handle malformed JSON gracefully
		expect(response).toBeDefined();
	});
});
