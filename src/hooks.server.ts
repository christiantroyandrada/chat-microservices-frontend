import type { Handle } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { httpRequestsTotal, httpRequestDurationSeconds } from '$lib/server/metrics';

/** UUID v4 pattern — rejects non-UUID values to prevent log injection (OWASP A03) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Server hooks for SvelteKit
 * - CSRF / proxy origin handling
 * - X-Request-ID propagation (validated UUID v4, never trusted raw)
 * - Structured HTTP access logging (stdout only — avoids log verbosity on /metrics scrapes)
 * - Prometheus request counter + latency histogram
 * - Security response headers
 */
export const handle: Handle = async ({ event, resolve }) => {
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

	const response = await resolve(event);

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

	return response;
};
