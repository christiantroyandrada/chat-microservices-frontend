import { apiClient } from './api';
import { logger } from './dev-logger';
import type {
	AuthUser,
	LoginCredentials,
	RegisterCredentials,
	User,
	EncryptedKeyBundle
} from '$lib/types';

export const authService = {
	/**
	 * Register a new user
	 */
	async register(credentials: RegisterCredentials): Promise<AuthUser> {
		// Normalize username to a safe handle and validate format before sending to backend
		const normalizedUsername = String(credentials.username || '')
			.replaceAll(/\u00A0/g, ' ')
			.replaceAll(/[\s\uFEFF\xA0]+/g, ' ')
			.trim()
			.toLowerCase();

		// Client-side validation: letters, numbers, underscores, hyphens; 3-30 chars
		const usernameRegex = /^[a-z0-9_-]{3,30}$/;
		if (!usernameRegex.test(normalizedUsername)) {
			throw new Error('Invalid username. Use 3-30 characters: letters, numbers, _ or -');
		}

		const payload = {
			username: normalizedUsername,
			email: credentials.email,
			password: credentials.password
		};

		// backend exposes registration at /register on the user router which is mounted
		// under /api/user by the gateway/nginx. Use the full path here.
		const response = await apiClient.post<AuthUser>('/user/register', payload);

		// Token is sent via httpOnly cookie (not in response body)
		// No need to extract or store token manually

		return response.data!;
	},

	/**
	 * Login user
	 */
	async login(credentials: LoginCredentials): Promise<AuthUser> {
		// login route on user service
		const response = await apiClient.post<AuthUser>('/user/login', credentials);

		// Token is sent via httpOnly cookie (not in response body)
		// No need to extract or store token manually

		return response.data!;
	},

	/**
	 * Logout user
	 */
	logout(): void {
		// Call backend logout to clear httpOnly cookie, then clear any UI state
		return apiClient.post('/user/logout').then(() => {
			if (typeof globalThis.window !== 'undefined') {
				// remove any temporary client-side caches
				try {
					localStorage.removeItem('user');
				} catch (e) {
					logger.warning('Failed to remove user from localStorage', e);
				}
			}
		}) as unknown as void;
	},

	/**
	 * Get current user profile
	 */
	async getCurrentUser(): Promise<User> {
		const response = await apiClient.get<unknown>('/user/me');
		const d = response.data as unknown as Record<string, unknown>;
		// Normalize backend shape { id, username, email } -> frontend User { _id, username, email }
		const user: User = {
			_id: String(d?.id ?? d?._id ?? ''),
			username: String(d?.username ?? ''),
			email: String(d?.email ?? '')
		};

		return user;
	},

	/**
	 * Store encrypted Signal Protocol keys on the backend for persistence across devices/tabs
	 * Keys are encrypted CLIENT-SIDE before transmission - server never sees plaintext keys
	 */
	async storeSignalKeys(deviceId: string, encryptedBundle: EncryptedKeyBundle): Promise<void> {
		await apiClient.post('/user/signal-keys', { deviceId, encryptedBundle });
	},

	/**
	 * Fetch encrypted Signal Protocol keys from the backend
	 * Returns null if no keys are stored
	 * Keys must be decrypted CLIENT-SIDE after retrieval
	 */
	async fetchSignalKeys(deviceId: string): Promise<EncryptedKeyBundle | null> {
		try {
			const response = await apiClient.get<{ encryptedBundle: EncryptedKeyBundle }>(
				`/user/signal-keys?deviceId=${deviceId}`
			);
			return response.data?.encryptedBundle || null;
		} catch (error: unknown) {
			// 404 means no keys stored yet - this is expected for new users
			if (typeof error === 'object' && error !== null && 'response' in error) {
				const httpError = error as { response?: { status?: number } };
				if (httpError.response?.status === 404) {
					return null;
				}
			}
			throw error;
		}
	}

	// Deprecated client-side token helpers removed. Authentication is verified
	// by calling `getCurrentUser()` which relies on httpOnly cookies sent by
	// the server. Any token storage in localStorage (e.g. `auth_token`) has
	// been removed from the codebase.
};
