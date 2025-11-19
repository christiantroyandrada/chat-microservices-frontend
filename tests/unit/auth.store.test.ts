/**
 * Unit tests for auth.store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock dependencies
const mockAuthService = {
	login: vi.fn(),
	register: vi.fn(),
	logout: vi.fn(),
	getCurrentUser: vi.fn()
};

const mockGoto = vi.fn();

vi.mock('$lib/services/auth.service', () => ({
	authService: mockAuthService
}));

vi.mock('$app/navigation', () => ({
	goto: mockGoto
}));

vi.mock('$app/environment', () => ({
	browser: true
}));

const mockLogger = {
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn()
};

vi.mock('$lib/services/dev-logger', () => ({
	logger: mockLogger
}));

describe('authStore', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		// Reset modules to clear state
		vi.resetModules();
	});

	it('should initialize with empty state', async () => {
		const { authStore } = await import('$lib/stores/auth.store');
		const state = get(authStore);
		expect(state.user).toBeNull();
		expect(state.loading).toBe(false);
		expect(state.error).toBeNull();
	});

	it('should login successfully', async () => {
		const mockUser = { _id: '1', username: 'testuser', email: 'test@test.com' };
		mockAuthService.login.mockResolvedValue(mockUser);
		mockAuthService.getCurrentUser.mockResolvedValue(mockUser);

		const { authStore } = await import('$lib/stores/auth.store');
		await authStore.login({ email: 'test@test.com', password: 'password' });

		const state = get(authStore);
		expect(state.user).toEqual(mockUser);
		expect(state.loading).toBe(false);
		expect(state.error).toBeNull();
		expect(mockGoto).toHaveBeenCalledWith('/chat');
	});

	it('should handle login failure', async () => {
		const mockError = { message: 'Invalid credentials' };
		mockAuthService.login.mockRejectedValue(mockError);

		const { authStore } = await import('$lib/stores/auth.store');

		await expect(authStore.login({ email: 'test@test.com', password: 'wrong' })).rejects.toEqual(
			mockError
		);

		const state = get(authStore);
		expect(state.user).toBeNull();
		expect(state.loading).toBe(false);
		expect(state.error).toBe('Invalid credentials');
	});

	it('should register successfully', async () => {
		const mockUser = { _id: '1', username: 'newuser', email: 'new@test.com' };
		mockAuthService.register.mockResolvedValue(mockUser);
		mockAuthService.getCurrentUser.mockResolvedValue(mockUser);

		const { authStore } = await import('$lib/stores/auth.store');
		await authStore.register({
			username: 'newuser',
			email: 'new@test.com',
			password: 'password'
		});

		const state = get(authStore);
		expect(state.user).toEqual(mockUser);
		expect(mockGoto).toHaveBeenCalledWith('/chat');
	});

	it('should logout successfully', async () => {
		mockAuthService.logout.mockResolvedValue(undefined);

		const { authStore } = await import('$lib/stores/auth.store');
		await authStore.logout();

		const state = get(authStore);
		expect(state.user).toBeNull();
		expect(mockGoto).toHaveBeenCalledWith('/login');
	});

	it('should clear error', async () => {
		const { authStore } = await import('$lib/stores/auth.store');

		// Set an error
		const mockError = { message: 'Test error' };
		mockAuthService.login.mockRejectedValue(mockError);
		await expect(authStore.login({ email: 'test@test.com', password: 'wrong' })).rejects.toEqual(
			mockError
		);

		// Clear the error
		authStore.clearError();

		const state = get(authStore);
		expect(state.error).toBeNull();
	});
});
