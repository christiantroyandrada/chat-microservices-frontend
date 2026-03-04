/**
 * SvelteKit Service Worker — McMaster-Carr-style tiered caching
 *
 * Strategy overview:
 *   BUILD + STATIC assets  → cache-first (content-hashed, immutable)
 *   Navigation HTML        → network-first, cached offline fallback
 *   API / WebSocket / auth → network-only (never cache sensitive data — OWASP)
 *
 * @see https://svelte.dev/docs/kit/service-workers
 */

// ── Type setup for service worker globals ────────────────────────────────
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { build, files, version } from '$service-worker';

const sw = globalThis.self as unknown as ServiceWorkerGlobalScope;

// ── Cache names (versioned so deploys auto-invalidate) ───────────────────
const STATIC_CACHE = `static-${version}`;
const RUNTIME_CACHE = `runtime-${version}`;

// All build + static assets to precache on install
const PRECACHE_ASSETS = [
	...build, // JS/CSS chunks (content-hashed by Vite)
	...files // everything in static/ (robots.txt, vendor libs, etc.)
];

// ── Routes/paths the SW must NEVER intercept ─────────────────────────────
// API calls, WebSocket polling, metrics — always go to network (OWASP A01)
const NETWORK_ONLY_PATTERNS = [
	/\/user\//,
	/\/chat\/socket\.io/,
	/\/chat\//,
	/\/notification/,
	/\/metrics/,
	/\/api\//,
	/\/health/
];

function isNetworkOnly(url: URL): boolean {
	return NETWORK_ONLY_PATTERNS.some((re) => re.test(url.pathname));
}

// ── Install: precache all build + static assets ──────────────────────────
sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(STATIC_CACHE)
			.then((cache) => cache.addAll(PRECACHE_ASSETS))
			.then(() => sw.skipWaiting()) // activate immediately
	);
});

// ── Activate: purge old caches from previous deploys ─────────────────────
sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
						.map((key) => caches.delete(key))
				)
			)
			.then(() => sw.clients.claim()) // take control of open tabs
	);
});

// ── Fetch: tiered strategy ───────────────────────────────────────────────
sw.addEventListener('fetch', (event) => {
	const { request } = event;

	// Only handle GET requests — let POST/PUT/DELETE pass through
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	// Same-origin only — don't intercept external requests
	if (url.origin !== sw.location.origin) return;

	// ── Network-only for API / auth / WebSocket ──────────────────────
	if (isNetworkOnly(url)) return;

	// ── Cache-first for precached build + static assets ──────────────
	if (PRECACHE_ASSETS.includes(url.pathname)) {
		event.respondWith(cacheFirst(request));
		return;
	}

	// ── Network-first for navigation (SSR HTML pages) ────────────────
	if (request.mode === 'navigate') {
		event.respondWith(networkFirst(request));
		return;
	}

	// ── Stale-while-revalidate for everything else ───────────────────
	event.respondWith(staleWhileRevalidate(request));
});

// ── Cache strategies ─────────────────────────────────────────────────────

/** Cache-first: instant response from cache, fallback to network */
async function cacheFirst(request: Request): Promise<Response> {
	const cached = await caches.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) {
		const cache = await caches.open(STATIC_CACHE);
		cache.put(request, response.clone());
	}
	return response;
}

/** Network-first: try network, fall back to cache for offline support */
async function networkFirst(request: Request): Promise<Response> {
	const cache = await caches.open(RUNTIME_CACHE);
	try {
		const response = await fetch(request);
		// Only cache successful responses (not auth redirects or errors)
		if (response.ok) {
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		// Offline — try to serve from cache
		const cached = await cache.match(request);
		if (cached) return cached;

		// No cache available — return a minimal offline indicator
		return new Response('Offline — please check your connection', {
			status: 503,
			headers: { 'Content-Type': 'text/plain' }
		});
	}
}

/** Stale-while-revalidate: serve cache instantly, update in background */
async function staleWhileRevalidate(request: Request): Promise<Response> {
	const cache = await caches.open(RUNTIME_CACHE);
	const cached = await cache.match(request);

	// Fire off network request in background (don't await)
	const networkPromise = fetch(request)
		.then((response) => {
			if (response.ok) {
				cache.put(request, response.clone());
			}
			return response;
		})
		.catch(() => cached ?? new Response('', { status: 503 }));

	// Return cached immediately if available, otherwise wait for network
	return cached ?? networkPromise;
}
