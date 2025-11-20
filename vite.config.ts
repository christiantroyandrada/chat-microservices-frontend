import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

// Avoid loading some Vite plugins (like Tailwind's Vite plugin) during
// Vitest runs. Many plugins start file-system watchers which can leave
// FSEVENTWRAP handles open and prevent the test process from exiting.
// Use nullish coalescing so we only fall back to NODE_ENV when VITEST is
// undefined or null (preserves explicit empty-string / falsy values if set).
const isVitest = Boolean(process.env.VITEST ?? process.env.NODE_ENV === 'test');

export default defineConfig({
	plugins: [!isVitest ? tailwindcss() : null, sveltekit()].filter(Boolean),
	optimizeDeps: {
		exclude: []
	},
	ssr: {
		noExternal: []
	},
	test: {
		// Enable the hanging-process reporter to help identify open handles that
		// prevent the Node process from exiting cleanly in CI. This reporter will
		// print stack traces for active handles when tests complete.
		reporters: ['default', 'hanging-process'],
		// Coverage configuration to generate LCOV (for SonarQube/other tools)
		coverage: {
			provider: 'istanbul', // use istanbul to generate lcov
			reporter: ['lcovonly', 'lcov', 'text', 'json', 'html'],
			reportsDirectory: 'coverage',
			all: true,
			include: ['src/**/*.{ts,js,svelte}'],
			exclude: [
				'tests/**',
				'node_modules/**',
				'src/**/*.d.ts',
				'src/**/types.ts',
				'src/**/*.spec.ts',
				'src/**/*.test.ts'
			],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80
			}
		},
		expect: { requireAssertions: false },
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
