import { defineConfig } from '@playwright/test';

const origin = new URL(process.env.FULLSTACK_ORIGIN ?? 'https://127.0.0.1:1');
if (origin.protocol !== 'https:' || origin.hostname !== '127.0.0.1') {
	throw new Error('The full-stack fixture requires a loopback HTTPS origin');
}
if (!process.env.FULLSTACK_EVIDENCE) throw new Error('FULLSTACK_EVIDENCE is required');

export default defineConfig({
	testDir: 'tests/fullstack',
	workers: 1,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 20_000 },
	outputDir: process.env.FULLSTACK_EVIDENCE,
	use: {
		baseURL: origin.origin,
		ignoreHTTPSErrors: true,
		trace: 'on',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	}
});
