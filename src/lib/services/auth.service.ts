import { apiClient } from './api';
import type { AuthUser, LoginCredentials, RegisterCredentials, User } from '$lib/types';

export const authService = {
	/**
	 * Register a new user
	 */
	async register(credentials: RegisterCredentials): Promise<AuthUser> {
		// Backend expects 'name' field, frontend uses 'username'
		// Normalize and sanitize to remove any hidden unicode characters
		// Use a safe, narrow cast instead of `any` to satisfy lint rules
		const creds = credentials as unknown as Record<string, unknown>;
		const rawName = (creds.name ?? creds.username ?? '') as string;
		const normalizedName = String(rawName)
			.replace(/\u00A0/g, ' ') // Replace non-breaking spaces
			.replace(/[\s\uFEFF\xA0]+/g, ' ') // Collapse whitespace
			.trim();

		const payload = {
			name: normalizedName,
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
			if (typeof window !== 'undefined') {
				// remove any temporary client-side caches
				try {
					localStorage.removeItem('user')
				} catch (e) {
					console.warn('Failed to remove user from localStorage', e)
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
		// Normalize backend shape { id, name, email } -> frontend User { _id, username, email }
		const user: User = {
			_id: String(d?.id ?? d?._id ?? ''),
			username: String(d?.name ?? d?.username ?? ''),
			email: String(d?.email ?? '')
		};

		return user;
	}

	// Deprecated client-side token helpers removed. Authentication is verified
	// by calling `getCurrentUser()` which relies on httpOnly cookies sent by
	// the server. Any token storage in localStorage (e.g. `auth_token`) has
	// been removed from the codebase.
};
