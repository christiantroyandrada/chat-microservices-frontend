import { writable, derived, get } from 'svelte/store';
import { authService } from '$lib/services/auth.service';
import type { LoginCredentials, RegisterCredentials, ApiError, AuthState } from '$lib/types';
import { goto } from '$app/navigation';
import { browser } from '$app/environment';
import { logger } from '$lib/services/dev-logger';
import { chatService } from '$lib/services/chat.service';

// Extended auth state with initialization tracking
interface ExtendedAuthState extends AuthState {
	initialized: boolean;
}

const initialState: ExtendedAuthState = {
	user: null,
	loading: false,
	error: null,
	initialized: false
};

function createAuthStore() {
	const { subscribe, set, update } = writable<ExtendedAuthState>(initialState);
	let initPromise: Promise<void> | null = null;
	let generation = 0;
	function startTransition() {
		generation++;
		chatService.activateOwner(null);
		set({ ...initialState, loading: true });
		return generation;
	}

	return {
		subscribe,

		/**
		 * Initialize auth state from httpOnly cookie
		 * Prevents race conditions by ensuring only one init runs at a time
		 */
		async init() {
			if (!browser) return;

			// If already initialized, don't re-run
			const currentState = get({ subscribe });
			if (currentState.initialized) {
				return;
			}

			// If already initializing, wait for existing init to complete
			if (initPromise !== null) {
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
			const attempt = generation;
			update((state) => ({ ...state, loading: true }));

			try {
				const user = await authService.getCurrentUser();
				if (attempt !== generation) return;
				chatService.activateOwner(user._id);
				await chatService
					.verifyOwner(user._id)
					.catch((error) => logger.warning('Message retry restore failed', error));
				if (attempt !== generation) return;
				update((state) => ({ ...state, user, loading: false, error: null, initialized: true }));
			} catch {
				if (attempt !== generation) return;
				chatService.activateOwner(null);
				// Failed logout must not block initialization.
				void authService.logout().catch((e) => logger.warning('Logout during init failed', e));
				// Always set initialized to true so the app can proceed
				set({ ...initialState, initialized: true });
			}
		},

		/**
		 * Login user
		 */
		async login(credentials: LoginCredentials) {
			const attempt = startTransition();
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				// Perform login (stores token) then fetch full user profile to avoid timing/race issues
				await authService.login(credentials);
				if (attempt !== generation) throw new Error('Authentication changed');
				const user = await authService.getCurrentUser();
				if (attempt !== generation) throw new Error('Authentication changed');
				chatService.activateOwner(user._id);
				await chatService
					.verifyOwner(user._id)
					.catch((error) => logger.warning('Message retry restore failed', error));
				if (attempt !== generation) throw new Error('Authentication changed');

				// Mark initialized: true so the layout's showLoading gate clears immediately
				// on client-side navigation to /chat without waiting for authStore.init().
				// NOTE: Callers (login/register pages) own navigation — they must complete
				// Signal Protocol init before calling goto('/chat') to prevent the race
				// condition where the chat page starts keyless Signal init concurrently.
				update((state) => ({ ...state, user, loading: false, error: null, initialized: true }));

				return user;
			} catch (error) {
				if (attempt !== generation) throw error;
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
		 * Register new user
		 */
		async register(credentials: RegisterCredentials) {
			const attempt = startTransition();
			update((state) => ({ ...state, loading: true, error: null }));

			try {
				// Perform registration (stores token) then fetch full user profile to avoid timing/race issues
				await authService.register(credentials);
				if (attempt !== generation) throw new Error('Authentication changed');
				const user = await authService.getCurrentUser();
				if (attempt !== generation) throw new Error('Authentication changed');
				chatService.activateOwner(user._id);
				await chatService
					.verifyOwner(user._id)
					.catch((error) => logger.warning('Message retry restore failed', error));
				if (attempt !== generation) throw new Error('Authentication changed');

				// Same as login() — mark initialized so the layout gate clears on navigation
				update((state) => ({ ...state, user, loading: false, error: null, initialized: true }));

				return user;
			} catch (error) {
				if (attempt !== generation) throw error;
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
			const attempt = startTransition();
			// Clear the cached encryption key from session storage
			if (browser) {
				try {
					sessionStorage.removeItem('_ek');
				} catch {
					// Ignore if sessionStorage is unavailable
				}
			}

			// Ensure backend clears the httpOnly cookie, wait for it before redirecting
			try {
				await authService.logout();
			} catch (e) {
				// still proceed with clearing client state even if logout call fails
				logger.warning('Logout API failed', e);
			}
			// Clear local auth state and navigate to login
			if (attempt !== generation) return;
			set({ ...initialState, initialized: true });
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
export const authInitialized = derived(authStore, ($auth) => $auth.initialized);
