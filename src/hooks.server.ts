import type { Handle } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { dev } from '$app/environment';
import { httpRequestsTotal, httpRequestDurationSeconds } from '$lib/server/metrics';

/** UUID v4 pattern — rejects non-UUID values to prevent log injection (OWASP A03) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Server hooks for SvelteKit
 * - CSRF / proxy origin handling
 * - X-Request-ID propagation (validated UUID v4, never trusted raw)
 * - Structured HTTP access logging (stdout only — avoids log verbosity on /metrics scrapes)
 * - Prometheus request counter + latency histogram
 * - Security + performance response headers
 * - Asset preload filter (fonts, critical JS)
 */
export const handle: Handle = async ({ event, resolve }) => {
	// ── Chrome DevTools workspace file ──────────────────────────────────
	// Chrome requests this on every page load in Chromium browsers.
	// Return a silent 404 rather than logging it as an unmatched route.
	// See: https://svelte.dev/docs/cli/devtools-json
	if (dev && event.url.pathname === '/.well-known/appspecific/com.chrome.devtools.json') {
		return new Response(undefined, { status: 404 });
	}

	const startNs = process.hrtime.bigint();

	// ── X-Request-ID ────────────────────────────────────────────────────
	// Validate the incoming header before trusting it (OWASP A03 log injection)
	const incomingId = event.request.headers.get('x-request-id') ?? undefined;
	const requestId = incomingId && UUID_RE.test(incomingId) ? incomingId : randomUUID();

	// ── Proxy origin (CSRF) ──────────────────────────────────────────────
	// SvelteKit uses ORIGIN env var for CSRF. No action needed here —
	// adapter-node picks it up from the ORIGIN env variable at startup.
	// (forwardedHost / forwardedProto are already handled by adapter-node
	//  via PROTOCOL_HEADER and HOST_HEADER env vars in docker-compose.)

	const response = await resolve(event, {
		// ── Asset preload filter ─────────────────────────────────────────
		// SvelteKit injects <link rel="modulepreload"> for JS and CSS by
		// default. We also allow font preloading if custom fonts are added
		// later, keeping the filter open for extension (OCP / SOLID).
		preload: ({ type }) => type === 'js' || type === 'css' || type === 'font'
	});

	// ── Metrics + logging ────────────────────────────────────────────────
	const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
	const method = event.request.method;
	const status = String(response.status);
	// Use the matched SvelteKit route id (e.g. "/chat/[id]") for low-cardinality labels
	const route = event.route?.id ?? 'unmatched';
	const labels = { method, route, status_code: status };

	httpRequestsTotal.inc(labels);
	httpRequestDurationSeconds.observe(labels, durationSec);

	// Skip access log for Prometheus scrapes — they're high-frequency noise
	if ((route as string) !== '/metrics') {
		const ms = (durationSec * 1000).toFixed(1);
		process.stdout.write(
			JSON.stringify({
				level: 'info',
				ts: new Date().toISOString(),
				service: 'frontend',
				requestId,
				method,
				route,
				status: response.status,
				durationMs: Number(ms)
			}) + '\n'
		);
	}

	// ── Security headers ─────────────────────────────────────────────────
	response.headers.set('X-Request-ID', requestId);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

	// ── Cache-Control (performance + OWASP A01 cache poisoning) ──────────
	// SSR HTML pages depend on auth cookies — prevent CDN / proxy caching
	// of personalised content. The service worker uses its own Cache API
	// independently, so this doesn't block offline support.
	// adapter-node / sirv already sets immutable headers for /_app/immutable/*
	if (!response.headers.has('cache-control')) {
		response.headers.set('Cache-Control', 'private, no-store');
	}

	return response;
};
