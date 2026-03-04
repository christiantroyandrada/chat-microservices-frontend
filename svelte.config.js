import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Use adapter-node for Docker deployment
		adapter: adapter({
			out: 'build',
			precompress: true
		}),
		// CSP with nonces — SvelteKit auto-adds nonces to its inline scripts/styles
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				// Build-time: use PUBLIC_API_URL (exported by the Dockerfile before pnpm run build)
				// Dev-time:   use NODE_ENV (Vite sets this to 'development' for pnpm dev)
				// Both cover the case where the API origin differs from the page origin
				// (e.g. HTTPS page + HTTP API on localhost, or Vite dev server on :5173 + nginx on :80).
				'connect-src': (() => {
					const base = ['self', 'ws:', 'wss:'];
					const apiUrl = process.env.PUBLIC_API_URL;
					if (apiUrl) {
						// Always include the exact API URL used at build time.
						// For dev builds this is 'http://localhost'; for prod it
						// is the production domain (covered by 'self' anyway, but harmless).
						try {
							const origin = new URL(apiUrl).origin;
							if (!base.includes(origin)) base.push(origin);
						} catch {
							// Malformed URL — skip
						}
					} else if (process.env.NODE_ENV === 'development') {
						// Local pnpm dev: Vite runs on :5173, API on :80 — different origins.
						base.push('http://localhost');
					}
					return base;
				})(),
				'img-src': ['self', 'data:', 'https://res.cloudinary.com'],
				'font-src': ['self'],
				'manifest-src': ['self'],
				'worker-src': ['self'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
