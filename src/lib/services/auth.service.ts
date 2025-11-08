import { apiClient } from './api';
import type { AuthUser, LoginCredentials, RegisterCredentials, User } from '$lib/types';

export const authService = {
	/**
	 * Register a new user
	 */
	async register(credentials: RegisterCredentials): Promise<AuthUser> {
		// backend exposes registration at /register on the user router which is mounted
		// under /api/user by the gateway/nginx. Use the full path here.
		const response = await apiClient.post<AuthUser>('/user/register', credentials);
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
		const response = await apiClient.get<User>('/user/me');
		return response.data!;
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
