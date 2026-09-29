/// <reference types="node" />
import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		env: {
			PUBLIC_API_URL: 'http://localhost:4173',
			PUBLIC_WS_URL: 'http://localhost:4173'
		},
		port: 4173,
		reuseExistingServer: false
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
