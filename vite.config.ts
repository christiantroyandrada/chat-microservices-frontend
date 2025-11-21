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
	// Disable file watcher in CI to prevent hanging processes
	server: {
		watch: process.env.CI
			? null
			: {
					ignored: ['**/node_modules/**', '**/.git/**']
				}
	},
	test: {
		// Explicitly disable watch mode in CI
		watch: false,
		// Enable the hanging-process reporter to help identify open handles that
		// prevent the Node process from exiting cleanly in CI. This reporter will
		// print stack traces for active handles when tests complete.
		reporters: ['default', 'hanging-process'],
		// Reduce file watcher timeout in CI
		fileParallelism: false,
		// Set timeouts for proper cleanup
		testTimeout: 30000,
		hookTimeout: 30000,
		teardownTimeout: 10000,
		// Coverage configuration to generate LCOV (for SonarQube/other tools)
		coverage: {
			provider: 'v8', // use V8 coverage provider
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
				'src/**/*.test.ts',
				'src/lib/types/**',
				'src/**/index.{ts,js}'
			],
			thresholds: {
				lines: 20,
				functions: 25,
				branches: 15,
				statements: 20
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
						instances: [{ browser: 'chromium' }],
						// Ensure browser closes properly after tests
						headless: true
					},
					include: ['tests/unit/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts'],
					// Pool options to ensure proper cleanup - use forks in CI for better cleanup
					pool: 'forks',
					poolOptions: {
						forks: {
							singleFork: true
						}
					}
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
					exclude: ['tests/unit/**/*.svelte.{test,spec}.{js,ts}'],
					// Pool options to ensure proper cleanup - use forks in CI for better cleanup
					pool: 'forks',
					poolOptions: {
						forks: {
							singleFork: true
						}
					}
				}
			}
		]
	}
});
