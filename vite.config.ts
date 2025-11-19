import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		exclude: []
	},
	ssr: {
		noExternal: []
	},
	test: {
		// Coverage configuration to generate LCOV (for SonarQube/other tools)
		coverage: {
			provider: 'istanbul', // use istanbul to generate lcov
			reporter: ['lcovonly', 'lcov', 'text', 'json'],
			reportsDirectory: 'coverage',
			all: true,
			include: ['src/**/*.{ts,js,svelte}'],
			exclude: ['tests/**', 'node_modules/**']
		},
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }]
					},
					include: ['tests/unit/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
					exclude: ['tests/unit/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
