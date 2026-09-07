/**
 * Unit tests for auth service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContractBoundaryError } from '$lib/services/contract-boundary';
import type { UserApiUser, UserApiSignalKeyBackupRequest } from '$lib/generated/api.types';
import type { ApiResponse } from '$lib/types';

// Mock the typed endpoint helper BEFORE importing the domain service
const mockUserApi = {
	register: vi.fn(),
	login: vi.fn(),
	logout: vi.fn(),
	getCurrentUser: vi.fn(),
	storeSignalKeys: vi.fn(),
	fetchSignalKeys: vi.fn()
};

vi.mock('$lib/services/api.generated', () => ({
	userApi: mockUserApi
}));

// Mock the logger
const mockLogger = {
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
	debug: vi.fn(),
	request: vi.fn(),
	requestor: vi.fn()
};

vi.mock('$lib/services/dev-logger', () => ({
	logger: mockLogger
}));

// Import after mocks are defined
const { authService } = await import('$lib/services/auth.service');

// Helper to create success response
const createSuccessResponse = <T>(data: T) => ({
	success: true,
	data
});

describe('authService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	describe('register', () => {
		it('normalizes the username and registered user shape', async () => {
			const credentials = {
				username: '  ALICE  ',
				email: 'alice@test.com',
				password: 'password123'
			};

			mockUserApi.register.mockResolvedValue(
				createSuccessResponse({
					id: 'user-alice-123',
					username: 'alice',
					email: 'alice@test.com'
				})
			);

			const result = await authService.register(credentials);

			expect(mockUserApi.register).toHaveBeenCalledWith({
				username: 'alice',
				email: 'alice@test.com',
				password: 'password123'
			});
			expect(result).toEqual({
				_id: 'user-alice-123',
				username: 'alice',
				email: 'alice@test.com'
			});
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
			mockUserApi.register.mockRejectedValue(error);

			await expect(authService.register(credentials)).rejects.toThrow('Email already exists');
		});
	});

	describe('login', () => {
		it('resolves undefined after a successful cookie-only login', async () => {
			const credentials = {
				email: 'alice@test.com',
				password: 'password123'
			};

			mockUserApi.login.mockResolvedValue({ success: true, message: 'Login successful' });

			const result = await authService.login(credentials);

			expect(mockUserApi.login).toHaveBeenCalledWith(credentials);
			expect(result).toBeUndefined();
		});

		it('should handle login error', async () => {
			const credentials = {
				email: 'wrong@test.com',
				password: 'wrongpassword'
			};

			const error = new Error('Invalid credentials');
			mockUserApi.login.mockRejectedValue(error);

			await expect(authService.login(credentials)).rejects.toThrow('Invalid credentials');
		});
	});

	describe('logout', () => {
		it('should logout user successfully', async () => {
			mockUserApi.logout.mockResolvedValue({ success: true });

			await expect(authService.logout()).resolves.toBeUndefined();
		});
	});

	describe('getCurrentUser', () => {
		it('should get current user profile', async () => {
			const backendUser = {
				id: 'user-alice-123',
				username: 'alice',
				email: 'alice@test.com'
			};

			mockUserApi.getCurrentUser.mockResolvedValue(createSuccessResponse(backendUser));

			const result = await authService.getCurrentUser();

			expect(result).toEqual({
				_id: 'user-alice-123',
				username: 'alice',
				email: 'alice@test.com'
			});
		});

		it('should handle missing user data', async () => {
			mockUserApi.getCurrentUser.mockResolvedValue(
				createSuccessResponse({} as unknown as UserApiUser)
			);

			await expect(authService.getCurrentUser()).rejects.toThrow(
				'user.getCurrentUser: id must be non-empty string'
			);
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

			mockUserApi.storeSignalKeys.mockResolvedValue({ success: true });

			await authService.storeSignalKeys(deviceId, encryptedBundle);

			expect(mockUserApi.storeSignalKeys).toHaveBeenCalledWith({
				deviceId,
				encryptedBundle
			});
		});
	});

	describe('fetchSignalKeys', () => {
		it('should fetch encrypted signal keys successfully', async () => {
			const deviceId = 'device-123';
			const encryptedBundle = {
				encrypted: 'encrypted-keys',
				iv: 'initialization-vector',
				salt: 'salt-value',
				version: 1,
				deviceId: 'device-123'
			};

			mockUserApi.fetchSignalKeys.mockResolvedValue(
				createSuccessResponse({ deviceId, encryptedBundle })
			);

			const result = await authService.fetchSignalKeys(deviceId);

			expect(result).toEqual(encryptedBundle);
		});

		it('should return null when no keys are stored (404)', async () => {
			const deviceId = 'device-123';

			const error404 = {
				response: { status: 404 }
			};

			mockUserApi.fetchSignalKeys.mockRejectedValue(error404);

			const result = await authService.fetchSignalKeys(deviceId);

			expect(result).toBeNull();
		});

		it('should return null when response data is missing', async () => {
			const deviceId = 'device-123';

			mockUserApi.fetchSignalKeys.mockResolvedValue(
				createSuccessResponse({} as unknown as UserApiSignalKeyBackupRequest)
			);

			await expect(authService.fetchSignalKeys(deviceId)).rejects.toThrow(
				'user.fetchSignalKeys: encryptedBundle is required'
			);
		});

		it('should throw non-404 errors', async () => {
			const deviceId = 'device-123';

			const error500 = {
				response: { status: 500 }
			};

			mockUserApi.fetchSignalKeys.mockRejectedValue(error500);

			await expect(authService.fetchSignalKeys(deviceId)).rejects.toEqual(error500);
		});

		it('should throw errors without response object', async () => {
			const deviceId = 'device-123';
			const networkError = new Error('Network error');

			mockUserApi.fetchSignalKeys.mockRejectedValue(networkError);

			await expect(authService.fetchSignalKeys(deviceId)).rejects.toThrow('Network error');
		});
	});

	describe('domain boundaries', () => {
		it('throws when register response missing id', async () => {
			mockUserApi.register.mockResolvedValue({
				success: true,
				data: { username: 'alice', email: 'alice@test.com' } as unknown as UserApiUser
			});
			await expect(
				authService.register({
					username: 'alice',
					email: 'alice@test.com',
					password: 'password123'
				})
			).rejects.toThrow('user.register: id must be non-empty string');
		});

		it('throws when register response has empty username', async () => {
			mockUserApi.register.mockResolvedValue({
				success: true,
				data: { id: 'u1', username: '', email: 'alice@test.com' } as unknown as UserApiUser
			});
			await expect(
				authService.register({
					username: 'alice',
					email: 'alice@test.com',
					password: 'password123'
				})
			).rejects.toThrow('user.register: username must be non-empty string');
		});

		it('throws when register response data is not object', async () => {
			mockUserApi.register.mockResolvedValue({ success: true, data: [] as unknown as UserApiUser });
			await expect(
				authService.register({
					username: 'alice',
					email: 'alice@test.com',
					password: 'password123'
				})
			).rejects.toBeInstanceOf(ContractBoundaryError);
		});

		it('throws when getCurrentUser response missing email', async () => {
			mockUserApi.getCurrentUser.mockResolvedValue({
				success: true,
				data: { id: 'u1', username: 'alice' } as unknown as UserApiUser
			});
			await expect(authService.getCurrentUser()).rejects.toThrow(
				'user.getCurrentUser: email must be non-empty string'
			);
		});

		it('throws when getCurrentUser data missing', async () => {
			mockUserApi.getCurrentUser.mockResolvedValue({
				success: true
			} as unknown as ApiResponse<UserApiUser>);
			await expect(authService.getCurrentUser()).rejects.toBeInstanceOf(ContractBoundaryError);
		});

		it('valid user fixture satisfies generated type', async () => {
			const valid = {
				id: 'user-1',
				username: 'alice',
				email: 'alice@test.com'
			} satisfies UserApiUser;
			mockUserApi.getCurrentUser.mockResolvedValue({ success: true, data: valid });
			const user = await authService.getCurrentUser();
			expect(user._id).toBe('user-1');
		});
	});
});
