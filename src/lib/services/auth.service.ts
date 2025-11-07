import { apiClient } from './api';
import type { AuthUser, LoginCredentials, RegisterCredentials, User } from '$lib/types';

export const authService = {
	/**
	 * Register a new user
	 */
	async register(credentials: RegisterCredentials): Promise<AuthUser> {
		const response = await apiClient.post<AuthUser>('/api/user/register', credentials);
		if (response.data) {
			this.setToken(response.data.token);
		}
		return response.data!;
	},

	/**
	 * Login user
	 */
	async login(credentials: LoginCredentials): Promise<AuthUser> {
		const response = await apiClient.post<AuthUser>('/api/user/login', credentials);
		if (response.data) {
			this.setToken(response.data.token);
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
		const response = await apiClient.get<User>('/api/user/me');
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
