import { env } from '$env/dynamic/public';
import type { ApiResponse, ApiError, ResponseShape } from '$lib/types';

const API_URL = env.PUBLIC_API_URL || 'http://localhost:85';

class ApiClient {
	private baseURL: string;
	private activeRequests: Map<string, AbortController> = new Map();

	constructor(baseURL: string) {
		this.baseURL = baseURL;
	}

	private getAuthHeaders(): HeadersInit {
		// Cookies are sent automatically with credentials: 'include'
		// No need to manually add Authorization header. We only set
		// Content-Type when a body is present (avoids sending it for GET requests).
		return {
			'Content-Type': 'application/json'
		};
	}
	// Token storage is deprecated — JWT is sent in an httpOnly cookie.

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
				credentials: 'include', // Send httpOnly cookies with requests
				signal: abortController.signal
			});

			// Clean up active request
			if (requestId) {
				this.activeRequests.delete(requestId);
			}

			// Some responses may be empty or not JSON; parse defensively.
			let data: unknown = null;
			try {
				const text = await response.text();
				data = text ? JSON.parse(text) : {};
			} catch (e) {
				// Non-JSON response — keep raw text
				data = { data: null, message: typeof e === 'object' ? String(e) : 'Invalid JSON' };
			}

			// Normalize parsed response to a safe object shape
			const normalized: ResponseShape = ((): ResponseShape => {
				if (data && typeof data === 'object') {
					return data as ResponseShape;
				}
				return { data } as ResponseShape;
			})();

			if (!response.ok) {
				throw {
					message: normalized.message || normalized.error || 'Request failed',
					status: response.status,
					errors: normalized.errors
				} as ApiError;
			}

			// Normalize data to the expected generic type T. We cast via unknown
			// because the runtime shape is dynamic (backend-controlled).
			const respData = (normalized.data ?? normalized) as unknown as T;

			// Cast the final response to the ApiResponse<T> shape so TypeScript
			// accepts the dynamic runtime-normalized fields preserved from the
			// backend. We still keep `data` strongly typed as T for callers.
			const finalResp = {
				success: true,
				data: respData,
				message: normalized.message,
				...(typeof normalized === 'object' ? normalized : {})
			} as unknown as ApiResponse<T>;

			return finalResp;
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
