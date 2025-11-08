import { env } from '$env/dynamic/public';
import type { ApiResponse, ApiError } from '$lib/types';

const API_URL = env.PUBLIC_API_URL || 'http://localhost:8080';

class ApiClient {
	private baseURL: string;

	constructor(baseURL: string) {
		this.baseURL = baseURL;
	}

	private getAuthHeaders(): HeadersInit {
		const token = this.getToken();
		return {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		};
	}

	private getToken(): string | null {
		if (typeof window === 'undefined') return null;
		return localStorage.getItem('auth_token');
	}

	async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
		try {
			const response = await fetch(`${this.baseURL}${endpoint}`, {
				...options,
				headers: {
					...this.getAuthHeaders(),
					...options.headers
				}
			});

			const data = await response.json();

			if (!response.ok) {
				throw {
					message: data.message || data.error || 'Request failed',
					status: response.status,
					errors: data.errors
				} as ApiError;
			}

			return {
				success: true,
				data: data.data || data,
				message: data.message
			};
		} catch (error) {
			if ((error as ApiError).status) {
				throw error;
			}
			throw {
				message: 'Network error. Please check your connection.',
				status: 0
			} as ApiError;
		}
	}

	async get<T>(endpoint: string): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { method: 'GET' });
	}

	async post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, {
			method: 'POST',
			body: JSON.stringify(body)
		});
	}

	async put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, {
			method: 'PUT',
			body: JSON.stringify(body)
		});
	}

	async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { method: 'DELETE' });
	}
}

export const apiClient = new ApiClient(API_URL);
