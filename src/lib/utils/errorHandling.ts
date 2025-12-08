/**
 * Shared error handling utilities for API responses
 *
 * Reduces code duplication across login/register pages and other forms.
 */

import type { ApiError } from '$lib/types';

export interface ParsedApiError {
	message: string;
	fieldErrors: Record<string, string>;
}

/**
 * Parse an API error into a user-friendly format with field-specific errors
 *
 * Handles multiple error formats from the backend:
 * 1. Array of errors: [{ field: 'email', message: 'Invalid email' }]
 * 2. Object of errors: { email: ['Invalid email'], password: ['Too weak'] }
 * 3. Simple message: { message: 'Something went wrong' }
 *
 * @param error - The error caught from an API call
 * @param defaultMessage - Fallback message if none provided
 * @returns Parsed error with message and field-specific errors
 */
export function parseApiError(
	error: unknown,
	defaultMessage = 'An error occurred'
): ParsedApiError {
	const apiError = error as ApiError;
	let message = defaultMessage;
	const fieldErrors: Record<string, string> = {};

	if (!apiError) {
		return { message, fieldErrors };
	}

	// Handle array of validation errors
	if (apiError.errors && Array.isArray(apiError.errors)) {
		for (const errItem of apiError.errors) {
			const e = errItem as Record<string, unknown>;
			const field = typeof e.field === 'string' ? e.field : undefined;
			const msg = typeof e.message === 'string' ? e.message : undefined;
			if (field && msg) {
				fieldErrors[field] = msg;
			}
		}
		message = apiError.message || 'Please fix the errors below';
	}
	// Handle object of validation errors
	else if (apiError.errors && typeof apiError.errors === 'object') {
		for (const [field, messages] of Object.entries(apiError.errors)) {
			fieldErrors[field] = Array.isArray(messages) ? messages[0] : (messages as string);
		}
		message = apiError.message || 'Please fix the errors below';
	}
	// Handle simple message
	else if (apiError.message) {
		message = apiError.message;
	}

	return { message, fieldErrors };
}

/**
 * Check if an error is a network/connection error
 */
export function isNetworkError(error: unknown): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return (
			message.includes('network') ||
			message.includes('connection') ||
			message.includes('timed out') ||
			message.includes('fetch failed')
		);
	}
	return false;
}

/**
 * Check if an error is an authentication error (401/403)
 */
export function isAuthError(error: unknown): boolean {
	const apiError = error as ApiError;
	return apiError?.status === 401 || apiError?.status === 403;
}
