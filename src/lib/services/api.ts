import { env } from '$env/dynamic/public';
import type { ApiResponse, ApiError, ResponseShape } from '$lib/types';
import { safeToString } from '$lib/utils';
import { ContractBoundaryError, type ResponseMode } from './contract-boundary';

const API_URL = env.PUBLIC_API_URL || 'http://localhost:80';
export type { ResponseMode };
type ApiRequestInit = RequestInit & { responseMode: ResponseMode };

class ApiClient {
	private readonly baseURL: string;
	private readonly activeRequests: Map<string, AbortController> = new Map();

	constructor(baseURL: string) {
		this.baseURL = baseURL;
	}

	private getAuthHeaders(): HeadersInit {
		return {
			'Content-Type': 'application/json'
		};
	}

	private cleanupRequest(requestId?: string): void {
		if (requestId) {
			this.activeRequests.delete(requestId);
		}
	}

	private async parseEnvelopeResponse(
		response: Response,
		endpoint: string
	): Promise<{ normalized: ResponseShape; respData: unknown }> {
		const text = await response.text();

		if (text === '') {
			if (response.ok) {
				throw new ContractBoundaryError(`${endpoint}: envelope response must be valid JSON object`);
			} else {
				const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
				throw new ErrClass(`Invalid JSON response: empty body`, response.status);
			}
		}

		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch (e) {
			if (response.ok) {
				throw new ContractBoundaryError(
					`${endpoint}: envelope response must be valid JSON: ${safeToString(e)}`
				);
			} else {
				const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
				throw new ErrClass(`Invalid JSON response: ${safeToString(e)}`, response.status);
			}
		}

		if (data === null || typeof data !== 'object' || Array.isArray(data)) {
			if (response.ok) {
				throw new ContractBoundaryError(`${endpoint}: envelope response must be non-null object`);
			} else {
				const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
				throw new ErrClass(`Invalid JSON response: expected object`, response.status);
			}
		}

		const normalized = data as ResponseShape;

		const hasEnvelopeKey = ['status', 'message', 'error', 'data'].some((key) =>
			Object.prototype.hasOwnProperty.call(normalized, key)
		);

		if (!hasEnvelopeKey) {
			if (response.ok) {
				throw new ContractBoundaryError(
					`${endpoint}: envelope response missing required envelope key (status, message, error, data)`
				);
			} else {
				const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
				throw new ErrClass(`Invalid envelope: missing status/message/error/data`, response.status);
			}
		}

		const hasOwnData = Object.prototype.hasOwnProperty.call(normalized, 'data');
		const respData = hasOwnData ? normalized.data : undefined;

		return { normalized, respData };
	}

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

	private readonly defaultTimeout = 10000;
	private readonly timeoutIds = new Map<AbortController, boolean>();

	async request<T, TMeta extends object = Record<never, never>>(
		endpoint: string,
		options: ApiRequestInit,
		requestId?: string
	): Promise<ApiResponse<T, TMeta>> {
		const abortController = new AbortController();
		const timeoutId = setTimeout(() => {
			this.timeoutIds.set(abortController, true);
			abortController.abort();
		}, this.defaultTimeout);

		if (requestId) {
			this.cancelRequest(requestId);
			this.activeRequests.set(requestId, abortController);
		}

		try {
			const { responseMode, ...fetchOptions } = options;
			const response = await fetch(`${this.baseURL}${endpoint}`, {
				...fetchOptions,
				headers: {
					...this.getAuthHeaders(),
					...options.headers
				},
				credentials: 'include',
				signal: abortController.signal
			});

			this.cleanupRequest(requestId);

			// Raw mode handling: need to preserve exact text for success, and map failure text to error
			if (responseMode === 'raw') {
				const text = await response.text();
				if (!response.ok) {
					const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
					const message = text !== '' ? text : 'Request failed';
					throw new ErrClass(message, response.status);
				}
				// For consistency with ApiResponse shape, raw mode returns data as text
				const finalResp = {
					success: true,
					data: text as unknown as T,
					message: undefined,
					error: undefined
				} as unknown as ApiResponse<T, TMeta>;
				return finalResp;
			}

			const { normalized, respData } = await this.parseEnvelopeResponse(response, endpoint);

			if (!response.ok) {
				const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
				throw new ErrClass(
					normalized.message || normalized.error || 'Request failed',
					response.status,
					normalized.errors as ApiError['errors']
				);
			}

			const reservedKeys = new Set(['status', 'success', 'data', 'message', 'error', 'errors']);
			const metadata = Object.fromEntries(
				Object.entries(normalized).filter(([key]) => !reservedKeys.has(key))
			);
			const finalResp = {
				...metadata,
				success: true,
				data: respData as T,
				message: normalized.message,
				error: normalized.error
			} as unknown as ApiResponse<T, TMeta>;

			return finalResp;
		} catch (error) {
			this.cleanupRequest(requestId);

			if (error instanceof ContractBoundaryError) {
				throw error;
			}

			if (error instanceof Error && error.name === 'AbortError') {
				const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
				const wasTimeout = this.timeoutIds.get(abortController);
				this.timeoutIds.delete(abortController);
				if (wasTimeout) {
					throw new ErrClass('Request timed out. Please try again.', 0);
				}
				throw new ErrClass('Request cancelled', 0);
			}

			if ((error as ApiError).status !== undefined && (error as ApiError).status !== 0) {
				throw error;
			}
			if (error instanceof (this.constructor as typeof ApiClient).ApiClientError) {
				throw error;
			}

			const ErrClass = (this.constructor as typeof ApiClient).ApiClientError;
			throw new ErrClass('Network error. Please check your connection.', 0);
		} finally {
			clearTimeout(timeoutId);
			this.timeoutIds.delete(abortController);
		}
	}

	cancelRequest(requestId: string): void {
		const controller = this.activeRequests.get(requestId);
		if (controller) {
			controller.abort();
			this.activeRequests.delete(requestId);
		}
	}

	cancelAllRequests(): void {
		this.activeRequests.forEach((controller) => controller.abort());
		this.activeRequests.clear();
	}

	async get<T, TMeta extends object = Record<never, never>>(
		endpoint: string,
		responseMode: ResponseMode,
		requestId?: string
	): Promise<ApiResponse<T, TMeta>> {
		return this.request<T, TMeta>(endpoint, { method: 'GET', responseMode }, requestId);
	}

	async getRaw<T>(endpoint: string, requestId?: string): Promise<T> {
		const response = await this.request<T>(
			endpoint,
			{ method: 'GET', responseMode: 'raw' },
			requestId
		);
		if (response.data === undefined) {
			throw new Error('Raw response contract error: data is missing');
		}
		return response.data;
	}

	async post<T, TMeta extends object = Record<never, never>>(
		endpoint: string,
		body: unknown,
		responseMode: ResponseMode,
		requestId?: string
	): Promise<ApiResponse<T, TMeta>> {
		return this.request<T, TMeta>(
			endpoint,
			{
				method: 'POST',
				body: body !== undefined ? JSON.stringify(body) : undefined,
				responseMode
			},
			requestId
		);
	}

	async put<T, TMeta extends object = Record<never, never>>(
		endpoint: string,
		body: unknown,
		responseMode: ResponseMode,
		requestId?: string
	): Promise<ApiResponse<T, TMeta>> {
		return this.request<T, TMeta>(
			endpoint,
			{
				method: 'PUT',
				body: body !== undefined ? JSON.stringify(body) : undefined,
				responseMode
			},
			requestId
		);
	}

	async delete<T, TMeta extends object = Record<never, never>>(
		endpoint: string,
		responseMode: ResponseMode,
		requestId?: string
	): Promise<ApiResponse<T, TMeta>> {
		return this.request<T, TMeta>(endpoint, { method: 'DELETE', responseMode }, requestId);
	}
}

export const apiClient = new ApiClient(API_URL);
