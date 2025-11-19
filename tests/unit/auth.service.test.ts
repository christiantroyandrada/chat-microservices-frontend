/**
 * Unit tests for auth service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testAuthUsers } from '../fixtures/users';

// Mock the API client BEFORE importing anything else
const mockApiClient = {
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
	patch: vi.fn()
};

vi.mock('$lib/services/api', () => ({
	apiClient: mockApiClient
}));

// Mock the logger
vi.mock('$lib/services/dev-logger', () => ({
	logger: {
		info: vi.fn(),
		warning: vi.fn(),
		error: vi.fn()
	}
}));

// Import after mocks are defined
const { authService } = await import('$lib/services/auth.service');

// Helper to create success response
const createSuccessResponse = <T>(data: T) => ({
	data,
	status: 200,
	statusText: 'OK',
	headers: {}
});

describe('authService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	describe('register', () => {
		it('should register a new user successfully', async () => {
			const credentials = {
				username: 'alice',
				email: 'alice@test.com',
				password: 'password123'
			};

			mockApiClient.post.mockResolvedValue(createSuccessResponse(testAuthUsers.alice));

			const result = await authService.register(credentials);

			expect(mockApiClient.post).toHaveBeenCalledWith('/user/register', {
				username: 'alice',
				email: 'alice@test.com',
				password: 'password123'
			});
			expect(result).toEqual(testAuthUsers.alice);
		});

		it('should normalize username with special characters', async () => {
			const credentials = {
				username: 'alice\u00A0test', // Non-breaking space
				email: 'alice@test.com',
				password: 'password123'
			};

			// Normalization produces a space which is invalid for usernames; expect validation error
			await expect(authService.register(credentials)).rejects.toThrow(
				'Invalid username. Use 3-30 characters: letters, numbers, _ or -'
			);
		});

		it('should handle registration error', async () => {
			const credentials = {
				username: 'alice',
				email: 'alice@test.com',
				password: 'password123'
			};

			const error = new Error('Email already exists');
			mockApiClient.post.mockRejectedValue(error);

			await expect(authService.register(credentials)).rejects.toThrow('Email already exists');
		});
	});

	describe('login', () => {
		it('should login user successfully', async () => {
			const credentials = {
				email: 'alice@test.com',
				password: 'password123'
			};

			mockApiClient.post.mockResolvedValue(createSuccessResponse(testAuthUsers.alice));

			const result = await authService.login(credentials);

			expect(mockApiClient.post).toHaveBeenCalledWith('/user/login', credentials);
			expect(result).toEqual(testAuthUsers.alice);
		});

		it('should handle login error', async () => {
			const credentials = {
				email: 'wrong@test.com',
				password: 'wrongpassword'
			};

			const error = new Error('Invalid credentials');
			mockApiClient.post.mockRejectedValue(error);

			await expect(authService.login(credentials)).rejects.toThrow('Invalid credentials');
		});
	});

	describe('logout', () => {
		it('should logout user successfully', async () => {
			mockApiClient.post.mockResolvedValue(createSuccessResponse({}));

			authService.logout();

			expect(mockApiClient.post).toHaveBeenCalledWith('/user/logout');
		});
	});

	describe('getCurrentUser', () => {
		it('should get current user profile', async () => {
			const backendUser = {
				id: 'user-alice-123',
				username: 'alice',
				email: 'alice@test.com'
			};

			mockApiClient.get.mockResolvedValue(createSuccessResponse(backendUser));

			const result = await authService.getCurrentUser();

			expect(mockApiClient.get).toHaveBeenCalledWith('/user/me');
			expect(result).toEqual({
				_id: 'user-alice-123',
				username: 'alice',
				email: 'alice@test.com'
			});
		});

		it('should handle missing user data', async () => {
			mockApiClient.get.mockResolvedValue(createSuccessResponse({}));

			const result = await authService.getCurrentUser();

			expect(result).toEqual({
				_id: '',
				username: '',
				email: ''
			});
		});
	});

	describe('storeSignalKeys', () => {
		it('should store encrypted signal keys', async () => {
			const deviceId = 'device-123';
			const encryptedBundle = {
				encrypted: 'encrypted-keys',
				iv: 'initialization-vector',
				salt: 'salt-value',
				version: 1,
				deviceId: 'device-123'
			};

			mockApiClient.post.mockResolvedValue(createSuccessResponse({}));

			await authService.storeSignalKeys(deviceId, encryptedBundle);

			expect(mockApiClient.post).toHaveBeenCalledWith('/user/signal-keys', {
				deviceId,
				encryptedBundle
			});
		});
	});
});
