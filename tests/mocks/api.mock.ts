/**
 * Mock API client for testing
 */

import { vi } from 'vitest';
import type { ApiResponse } from '$lib/types';

export const mockApiClient = {
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
	patch: vi.fn()
};

/**
 * Create a successful API response
 */
export function createSuccessResponse<T>(data: T): ApiResponse<T> {
	return {
		success: true,
		data
	};
}

/**
 * Create an error API response
 */
export function createErrorResponse(message: string): ApiResponse<never> {
	return {
		success: false,
		error: message,
		message: message
	};
}

/**
 * Reset all API mocks
 */
export function resetApiMocks() {
	mockApiClient.get.mockReset();
	mockApiClient.post.mockReset();
	mockApiClient.put.mockReset();
	mockApiClient.delete.mockReset();
	mockApiClient.patch.mockReset();
}
