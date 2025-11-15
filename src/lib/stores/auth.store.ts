import { writable, derived } from 'svelte/store';
import { authService } from '$lib/services/auth.service';
import type { LoginCredentials, RegisterCredentials, ApiError, AuthState } from '$lib/types';
import { goto } from '$app/navigation';
import { browser } from '$app/environment';
import { logger } from '$lib/services/dev-logger';

const initialState: AuthState = {
	user: null,
	loading: false,
	error: null
};

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>(initialState);
	let initPromise: Promise<void> | null = null;

	return {
		subscribe,

		/**
		 * Initialize auth state from httpOnly cookie
		 * Prevents race conditions by ensuring only one init runs at a time
		 */
		async init() {
			if (!browser) return;

			// If already initializing, wait for existing init to complete
			if (initPromise) {
				return initPromise;
			}

			// With httpOnly cookies, we can't check token client-side
			// Try to fetch current user to verify authentication
			initPromise = this._performInit();
			await initPromise;
			initPromise = null;
		},

		/**
		 * Internal initialization logic
		 */
		async _performInit() {
			update((state) => ({ ...state, loading: true }));

			try {
				const user = await authService.getCurrentUser();
				update((state) => ({ ...state, user, loading: false, error: null }));
			} catch {
				// Token is invalid, clear it
				try {
					await authService.logout();
				} catch (e) {
					logger.warning('Logout during init failed', e);
				}
				set(initialState);
			}
		},

		/**
		 * Login user
		 */
		async login(credentials: LoginCredentials) {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				// Perform login (stores token) then fetch full user profile to avoid timing/race issues
				await authService.login(credentials);
				const user = await authService.getCurrentUser();

				update((state) => ({ ...state, user, loading: false, error: null }));

				void goto('/chat');
				return user;
			} catch (error) {
				const apiError = error as ApiError;
				update((state) => ({
					...state,
					loading: false,
					error: apiError.message
				}));
				throw error;
			}
		} /**
		 * Register new user
		 */,
		async register(credentials: RegisterCredentials) {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				// Perform registration (stores token) then fetch full user profile to avoid timing/race issues
				await authService.register(credentials);
				const user = await authService.getCurrentUser();

				update((state) => ({ ...state, user, loading: false, error: null }));

				void goto('/chat');
				return user;
			} catch (error) {
				const apiError = error as ApiError;
				update((state) => ({
					...state,
					loading: false,
					error: apiError.message
				}));
				throw error;
			}
		},

		/**
		 * Logout user
		 */
		async logout() {
			// Ensure backend clears the httpOnly cookie, wait for it before redirecting
			try {
				await authService.logout();
			} catch (e) {
				// still proceed with clearing client state even if logout call fails
				logger.warning('Logout API failed', e);
			}
			// Clear local auth state and navigate to login
			set(initialState);
			void goto('/login');
		} /**
		 * Clear error
		 */,
		clearError() {
			update((state) => ({ ...state, error: null }));
		}
	};
}

export const authStore = createAuthStore();

// Derived stores for convenience
export const user = derived(authStore, ($auth) => $auth.user);
export const isAuthenticated = derived(authStore, ($auth) => !!$auth.user);
export const authLoading = derived(authStore, ($auth) => $auth.loading);
export const authError = derived(authStore, ($auth) => $auth.error);
