/* stylelint-disable */
/// <reference types="node" />
// Ensure the TypeScript language server knows Node globals (process) for this standalone config file.
import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: true
	},
	testDir: 'tests/e2e',
	use: {
		baseURL: 'http://localhost:4173',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined
});
