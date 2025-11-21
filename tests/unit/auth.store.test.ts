import { vi, describe, it, expect, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { LoginCredentials, RegisterCredentials } from '$lib/types';
import { get } from 'svelte/store';

// We'll reset modules each test so the store is re-created with our mocks
beforeEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('authStore', () => {
	it('init does nothing when not in browser', async () => {
		vi.doMock('$app/environment', () => ({ browser: false }));

		const authServiceMock = {
			getCurrentUser: vi.fn()
		};
		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));

		const { authStore, user } = await import('$lib/stores/auth.store');

		await authStore.init();
		expect(authServiceMock.getCurrentUser).not.toHaveBeenCalled();
		expect(get(user)).toBeNull();
	});

	it('init fetches user when in browser and only runs once concurrently', async () => {
		vi.doMock('$app/environment', () => ({ browser: true }));
		const userObj = { id: 'u1', name: 'U1' };

		let resolver: (v: unknown) => void;
		const getCurrentUser = vi.fn(() => new Promise((res) => (resolver = res)));
		const authServiceMock = {
			getCurrentUser,
			logout: vi.fn()
		};
		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));

		const { authStore, user } = await import('$lib/stores/auth.store');

		// Call init twice before resolving getCurrentUser
		const p1 = authStore.init();
		const p2 = authStore.init();

		// ensure getCurrentUser called once so far
		expect(getCurrentUser).toHaveBeenCalledTimes(1);

		// resolve
		resolver!(userObj);
		await Promise.all([p1, p2]);

		expect(get(user)).toEqual(userObj);
		expect(getCurrentUser).toHaveBeenCalledTimes(1);
	});

	it('init handles getCurrentUser failure by calling logout and resetting state', async () => {
		vi.doMock('$app/environment', () => ({ browser: true }));

		const getCurrentUser = vi.fn(() => Promise.reject(new Error('nope')));
		const logout = vi.fn(() => Promise.resolve());
		const authServiceMock = { getCurrentUser, logout };
		const logger = { warning: vi.fn() };

		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));
		vi.doMock('$lib/services/dev-logger', () => ({ logger }));

		const { authStore, user } = await import('$lib/stores/auth.store');

		await authStore.init();

		expect(logout).toHaveBeenCalled();
		expect(get(user)).toBeNull();
	});

	it('login success stores user and navigates to /chat', async () => {
		vi.doMock('$app/environment', () => ({ browser: true }));
		const login = vi.fn(() => Promise.resolve());
		const getCurrentUser = vi.fn(() => Promise.resolve({ id: 'x' }));
		const authServiceMock = { login, getCurrentUser };
		const goto = vi.fn();

		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));
		vi.doMock('$app/navigation', () => ({ goto }));

		const { authStore, user, isAuthenticated } = await import('$lib/stores/auth.store');

		const out = await authStore.login({
			email: 'a@example.com',
			password: 'b'
		} as LoginCredentials);
		expect(out).toEqual({ id: 'x' });
		expect(get(user)).toEqual({ id: 'x' });
		expect(get(isAuthenticated)).toBe(true);
		expect(goto).toHaveBeenCalledWith('/chat');
	});

	it('login failure sets error and rethrows', async () => {
		vi.doMock('$app/environment', () => ({ browser: true }));
		const apiError = new Error('bad creds');
		const login = vi.fn(() => Promise.reject(apiError));
		const getCurrentUser = vi.fn();
		const authServiceMock = { login, getCurrentUser };

		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));

		const { authStore, authError } = await import('$lib/stores/auth.store');

		await expect(authStore.login({} as unknown as LoginCredentials)).rejects.toBe(apiError);
		expect(get(authError)).toBe(apiError.message);
	});

	it('register success stores user and navigates to /chat', async () => {
		vi.doMock('$app/environment', () => ({ browser: true }));
		const register = vi.fn(() => Promise.resolve());
		const getCurrentUser = vi.fn(() => Promise.resolve({ id: 'r' }));
		const authServiceMock = { register, getCurrentUser };
		const goto = vi.fn();

		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));
		vi.doMock('$app/navigation', () => ({ goto }));

		const { authStore, user } = await import('$lib/stores/auth.store');

		const out = await authStore.register({
			username: 'u',
			email: 'u@example.com',
			password: 'p'
		} as RegisterCredentials);
		expect(out).toEqual({ id: 'r' });
		expect(get(user)).toEqual({ id: 'r' });
		expect(goto).toHaveBeenCalledWith('/chat');
	});

	it('register failure sets error and rethrows', async () => {
		vi.doMock('$app/environment', () => ({ browser: true }));
		const apiError = new Error('nope');
		const register = vi.fn(() => Promise.reject(apiError));
		const getCurrentUser = vi.fn();
		const authServiceMock = { register, getCurrentUser };

		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));

		const { authStore, authError } = await import('$lib/stores/auth.store');

		await expect(authStore.register({} as unknown as RegisterCredentials)).rejects.toBe(apiError);
		expect(get(authError)).toBe(apiError.message);
	});

	it('logout attempts API logout and always clears state and navigates to /login', async () => {
		vi.doMock('$app/environment', () => ({ browser: true }));
		const logout = vi.fn(() => Promise.resolve());
		const authServiceMock = { logout };
		const goto = vi.fn();

		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));
		vi.doMock('$app/navigation', () => ({ goto }));

		const { authStore, user } = await import('$lib/stores/auth.store');

		// set a user first
		// stub login/getCurrentUser to avoid errors when calling login
		const svc = (await import('$lib/services/auth.service')).authService as unknown as {
			login?: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
			getCurrentUser?: MockedFunction<() => Promise<unknown>>;
		};
		svc.login = vi.fn(() => Promise.resolve());
		svc.getCurrentUser = vi.fn(() => Promise.resolve({ id: 'pre' }));
		try {
			await authStore.login?.({} as unknown as LoginCredentials);
		} catch {
			// noop
		}

		// perform logout
		await authStore.logout();
		expect(logout).toHaveBeenCalled();
		expect(get(user)).toBeNull();
		expect(goto).toHaveBeenCalledWith('/login');
	});

	it('logout swallows API error and still clears state and navigates', async () => {
		vi.doMock('$app/environment', () => ({ browser: true }));
		const logout = vi.fn(() => Promise.reject(new Error('boom')));
		const authServiceMock = { logout };
		const goto = vi.fn();
		const logger = { warning: vi.fn() };

		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));
		vi.doMock('$app/navigation', () => ({ goto }));
		vi.doMock('$lib/services/dev-logger', () => ({ logger }));

		const { authStore, user } = await import('$lib/stores/auth.store');

		await authStore.logout();
		expect(logout).toHaveBeenCalled();
		expect((await import('$lib/services/dev-logger')).logger.warning).toHaveBeenCalled();
		expect(get(user)).toBeNull();
		expect(goto).toHaveBeenCalledWith('/login');
	});

	it('clearError clears error state', async () => {
		vi.doMock('$app/environment', () => ({ browser: true }));
		const authServiceMock = { getCurrentUser: vi.fn() };
		vi.doMock('$lib/services/auth.service', () => ({ authService: authServiceMock }));

		const { authStore, authError } = await import('$lib/stores/auth.store');

		// set error by mocking login to fail
		const svc = (await import('$lib/services/auth.service')).authService as unknown as {
			login?: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
			getCurrentUser?: MockedFunction<() => Promise<unknown>>;
		};
		svc.login = vi.fn(() => Promise.reject(new Error('err')));

		await expect(authStore.login({} as unknown as LoginCredentials)).rejects.toBeDefined();
		expect(get(authError)).toBe('err');

		authStore.clearError();
		expect(get(authError)).toBeNull();
	});
});
