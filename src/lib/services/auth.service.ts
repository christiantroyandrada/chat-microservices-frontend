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
		if (response.data) {
			if ((response.data as AuthUser).token) {
				this.setToken((response.data as AuthUser).token);
			}
		}
		return response.data!;
	},

	/**
	 * Login user
	 */
	async login(credentials: LoginCredentials): Promise<AuthUser> {
		// login route on user service
		const response = await apiClient.post<AuthUser>('/user/login', credentials);
		if (response.data) {
			if ((response.data as AuthUser).token) {
				this.setToken((response.data as AuthUser).token);
			}
		}
		return response.data!;
	},

	/**
	 * Logout user
	 */
	logout(): void {
		if (typeof window !== 'undefined') {
			localStorage.removeItem('auth_token');
			localStorage.removeItem('user');
		}
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
	},

	/**
	 * Store authentication token
	 */
	setToken(token: string): void {
		if (typeof window !== 'undefined') {
			localStorage.setItem('auth_token', token);
		}
	},

	/**
	 * Get stored token
	 */
	getToken(): string | null {
		if (typeof window !== 'undefined') {
			return localStorage.getItem('auth_token');
		}
		return null;
	},

	/**
	 * Check if user is authenticated
	 */
	isAuthenticated(): boolean {
		return !!this.getToken();
	}
};
