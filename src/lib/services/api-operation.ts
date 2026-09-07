import { apiClient } from './api';
import { ContractBoundaryError } from './contract-boundary';
import type { GeneratedApiOperation } from '$lib/generated/api.operations';
import type { ApiResponse } from '$lib/types';

export async function executeOperation<T, TMeta extends object = Record<never, never>>(
	operation: GeneratedApiOperation,
	params: Record<string, unknown> = {},
	body?: unknown
): Promise<ApiResponse<T, TMeta>> {
	const { method, path, responseMode, parameters } = operation;

	const declaredNames = new Set(parameters.map((p) => p.name));
	for (const key of Object.keys(params)) {
		if (!declaredNames.has(key)) {
			throw new ContractBoundaryError(`${operation.operationId}: unknown parameter ${key}`);
		}
	}

	let url = path;
	for (const param of parameters.filter((p) => p.in === 'path')) {
		const value = params[param.name];
		if (value === undefined || value === null || String(value).length === 0) {
			throw new ContractBoundaryError(
				`${operation.operationId}: missing required path parameter ${param.name}`
			);
		}
		const encoded = encodeURIComponent(String(value));
		const placeholder = `{${param.name}}`;
		if (!url.includes(placeholder)) {
			throw new ContractBoundaryError(
				`${operation.operationId}: path template missing placeholder ${placeholder} for ${path}`
			);
		}
		url = url.replace(placeholder, encoded);
	}

	const queryParts: string[] = [];
	for (const param of parameters.filter((p) => p.in === 'query')) {
		const value = params[param.name];
		if (value === undefined) {
			if (param.required) {
				throw new ContractBoundaryError(
					`${operation.operationId}: missing required query parameter ${param.name}`
				);
			}
			continue;
		}
		if (param.required && (value === null || String(value).length === 0)) {
			throw new ContractBoundaryError(
				`${operation.operationId}: missing required query parameter ${param.name}`
			);
		}
		queryParts.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(String(value))}`);
	}

	if (queryParts.length > 0) {
		url += `?${queryParts.join('&')}`;
	}

	if (url.includes('{') || url.includes('}')) {
		throw new ContractBoundaryError(
			`${operation.operationId}: unresolved path template after substitution: ${url}`
		);
	}

	const hasBody = body !== undefined;
	const options: RequestInit & { responseMode: typeof responseMode } = {
		method,
		responseMode
	} as unknown as RequestInit & { responseMode: typeof responseMode };

	if (hasBody) {
		(options as unknown as Record<string, unknown>).body = JSON.stringify(body);
	}

	return apiClient.request<T, TMeta>(
		url,
		options as unknown as RequestInit & { responseMode: typeof responseMode }
	);
}
