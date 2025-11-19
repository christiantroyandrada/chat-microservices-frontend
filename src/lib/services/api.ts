import { env } from '$env/dynamic/public';
import type { ApiResponse, ApiError, ResponseShape } from '$lib/types';
import { safeToString } from '$lib/utils';

const API_URL = env.PUBLIC_API_URL || 'http://localhost:85';

class ApiClient {
	private readonly baseURL: string;
	private readonly activeRequests: Map<string, AbortController> = new Map();

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

	/**
	 * Remove a tracked active request (if any)
	 */
	private cleanupRequest(requestId?: string): void {
		if (requestId) {
			this.activeRequests.delete(requestId);
		}
	}

	/**
	 * Parse fetch response defensively into a normalized ResponseShape and
	 * extracted runtime data.
	 */
	private async parseResponse(
		response: Response
	): Promise<{ normalized: ResponseShape; respData: unknown }> {
		let data: unknown = null;
		try {
			const text = await response.text();
			data = text ? JSON.parse(text) : {};
		} catch (e) {
			// Non-JSON response — keep raw text
			data = { data: null, message: safeToString(e) };
		}

		const normalized: ResponseShape = ((): ResponseShape => {
			if (data && typeof data === 'object') {
				return data as ResponseShape;
			}
			return { data } as ResponseShape;
		})();

		const respData = (normalized.data ?? normalized) as unknown;
		return { normalized, respData };
	}

	/**
	 * Runtime Error type used by this client so we always throw Error instances
	 * (satisfies linters like Sonar S3696) while preserving ApiError fields.
	 */
	private static readonly ApiClientError = class ApiClientError extends Error implements ApiError {
		status: number;
		errors?: ApiError['errors'];

		constructor(message: string, status = 0, errors?: ApiError['errors']) {
			super(message);
			this.name = 'ApiError';
			this.status = status;
			this.errors = errors;
			Object.setPrototypeOf(this, new.target.prototype);
		}
	};
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

		// Track for cancellation if caller provided an id
		if (requestId) {
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
				credentials: 'include',
				signal: abortController.signal
			});

			// Always remove tracking for this request
			this.cleanupRequest(requestId);

			const { normalized, respData } = await this.parseResponse(response);

			if (!response.ok) {
				const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
				throw new ErrClass(
					normalized.message || normalized.error || 'Request failed',
					response.status,
					normalized.errors as ApiError['errors']
				);
			}

			const finalResp = {
				success: true,
				data: respData as T,
				message: normalized.message,
				...(typeof normalized === 'object' ? normalized : {})
			} as unknown as ApiResponse<T>;

			return finalResp;
		} catch (error) {
			this.cleanupRequest(requestId);

			if (error instanceof Error && error.name === 'AbortError') {
				const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
				throw new ErrClass('Request cancelled', 0);
			}

			if ((error as ApiError).status) {
				throw error;
			}

			const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
			throw new ErrClass('Network error. Please check your connection.', 0);
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
