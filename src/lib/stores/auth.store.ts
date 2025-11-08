import { writable, derived } from 'svelte/store';
import { authService } from '$lib/services/auth.service';
import type { User, LoginCredentials, RegisterCredentials, ApiError } from '$lib/types';
import { goto } from '$app/navigation';
import { browser } from '$app/environment';

interface AuthState {
	user: User | null;
	loading: boolean;
	error: string | null;
}

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
		 * Initialize auth state from stored token
		 * Prevents race conditions by ensuring only one init runs at a time
		 */
		async init() {
			if (!browser) return;

			// If already initializing, wait for existing init to complete
			if (initPromise) {
				return initPromise;
			}

			const token = authService.getToken();
			if (!token) {
				set(initialState);
				return;
			}

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
				authService.logout();
				set(initialState);
			}
		},

		/**
		 * Login user
		 */
		async login(credentials: LoginCredentials) {
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				const authUser = await authService.login(credentials);
				const { token: _token, ...user } = authUser;

				update((state) => ({ ...state, user, loading: false, error: null }));

				// Store user data
				if (browser) {
					localStorage.setItem('user', JSON.stringify(user));
				}

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
				const authUser = await authService.register(credentials);
				const { token: _token, ...user } = authUser;

				update((state) => ({ ...state, user, loading: false, error: null }));

				// Store user data
				if (browser) {
					localStorage.setItem('user', JSON.stringify(user));
				}

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
		logout() {
			authService.logout();
			if (browser) {
				localStorage.removeItem('user');
			}
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
