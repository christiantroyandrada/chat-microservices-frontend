import type { Handle } from '@sveltejs/kit';

/**
 * Server hooks for SvelteKit
 * Handles CSRF protection and request processing
 */
export const handle: Handle = async ({ event, resolve }) => {
	// Handle origin verification for CSRF protection
	// SvelteKit automatically checks ORIGIN header, but we need to help it
	// when running behind a reverse proxy (nginx) that uses different internal ports

	// Get the forwarded host if behind proxy
	const forwardedHost = event.request.headers.get('x-forwarded-host');
	const forwardedProto = event.request.headers.get('x-forwarded-proto');

	// If we have forwarded headers, we're behind a proxy
	// The internal port (8443) should not appear in URLs
	if (forwardedHost && forwardedProto) {
		// The ORIGIN env var should match the public URL
		// SvelteKit uses this for CSRF protection
	}

	const response = await resolve(event);

	// Add security headers
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('X-Content-Type-Options', 'nosniff');

	return response;
};
