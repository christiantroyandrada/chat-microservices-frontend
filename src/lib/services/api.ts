import { env } from '$env/dynamic/public';
import type { ApiResponse, ApiError } from '$lib/types';

const API_URL = env.PUBLIC_API_URL || 'http://localhost:8080';

class ApiClient {
	private baseURL: string;
	private activeRequests: Map<string, AbortController> = new Map();

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

	/**
	 * Make an HTTP request with automatic cancellation support
	 */
	async request<T>(
		endpoint: string,
		options: RequestInit = {},
		requestId?: string
	): Promise<ApiResponse<T>> {
		// Create abort controller for this request
		const abortController = new AbortController();

		// Store with unique ID for cancellation
		if (requestId) {
			// Cancel any existing request with same ID
			this.cancelRequest(requestId);
			this.activeRequests.set(requestId, abortController);
		}

		try {
			const response = await fetch(`${this.baseURL}${endpoint}`, {
				...options,
				headers: {
					...this.getAuthHeaders(),
					...options.headers
				},
				signal: abortController.signal
			});

			// Clean up active request
			if (requestId) {
				this.activeRequests.delete(requestId);
			}

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
			// Clean up active request
			if (requestId) {
				this.activeRequests.delete(requestId);
			}

			// Handle abort errors
			if (error instanceof Error && error.name === 'AbortError') {
				throw {
					message: 'Request cancelled',
					status: 0
				} as ApiError;
			}

			if ((error as ApiError).status) {
				throw error;
			}
			throw {
				message: 'Network error. Please check your connection.',
				status: 0
			} as ApiError;
		}
	}

	/**
	 * Cancel a specific request by ID
	 */
	cancelRequest(requestId: string): void {
		const controller = this.activeRequests.get(requestId);
		if (controller) {
			controller.abort();
			this.activeRequests.delete(requestId);
		}
	}

	/**
	 * Cancel all active requests
	 */
	cancelAllRequests(): void {
		this.activeRequests.forEach((controller) => controller.abort());
		this.activeRequests.clear();
	}

	async get<T>(endpoint: string, requestId?: string): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { method: 'GET' }, requestId);
	}

	async post<T>(endpoint: string, body?: unknown, requestId?: string): Promise<ApiResponse<T>> {
		return this.request<T>(
			endpoint,
			{
				method: 'POST',
				body: JSON.stringify(body)
			},
			requestId
		);
	}

	async put<T>(endpoint: string, body?: unknown, requestId?: string): Promise<ApiResponse<T>> {
		return this.request<T>(
			endpoint,
			{
				method: 'PUT',
				body: JSON.stringify(body)
			},
			requestId
		);
	}

	async delete<T>(endpoint: string, requestId?: string): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { method: 'DELETE' }, requestId);
	}
}

export const apiClient = new ApiClient(API_URL);
