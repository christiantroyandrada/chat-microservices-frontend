/**
 * Server-side Prometheus metrics for the SvelteKit frontend container.
 *
 * This file lives in $lib/server/ so it is NEVER bundled into the client.
 * prom-client runs only in the Node.js adapter-node process.
 *
 * Metric naming follows the same conventions as the backend services so
 * all four containers appear consistently in the Grafana dashboard.
 */
import client, { type Registry } from 'prom-client';

// ── Singleton guard ────────────────────────────────────────────────────────
// SvelteKit may hot-reload this module in dev; guard against double-registration.
function getOrCreateCounter(
	registry: Registry,
	name: string,
	help: string,
	labelNames: string[]
): client.Counter {
	const existing = registry.getSingleMetric(name);
	if (existing) return existing as client.Counter;
	return new client.Counter({ name, help, labelNames, registers: [registry] });
}

function getOrCreateHistogram(
	registry: Registry,
	name: string,
	help: string,
	labelNames: string[],
	buckets: number[]
): client.Histogram {
	const existing = registry.getSingleMetric(name);
	if (existing) return existing as client.Histogram;
	return new client.Histogram({ name, help, labelNames, buckets, registers: [registry] });
}

// ── Registry ───────────────────────────────────────────────────────────────
const registry = new client.Registry();
registry.setDefaultLabels({ service: 'frontend' });

// Default Node.js metrics (event loop lag, memory, GC, handles) — guarded
if (!registry.getSingleMetric('nodejs_version_info')) {
	client.collectDefaultMetrics({ register: registry });
}

// ── Application metrics ────────────────────────────────────────────────────
export const httpRequestsTotal = getOrCreateCounter(
	registry,
	'http_requests_total',
	'Total HTTP requests processed by the frontend SSR server',
	['method', 'route', 'status_code']
);

export const httpRequestDurationSeconds = getOrCreateHistogram(
	registry,
	'http_request_duration_seconds',
	'HTTP request duration in seconds (frontend SSR)',
	['method', 'route', 'status_code'],
	[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]
);

// ── Helpers for the /metrics endpoint ─────────────────────────────────────
export const getMetrics = (): Promise<string> => registry.metrics();
export const getContentType = (): string => registry.contentType;
