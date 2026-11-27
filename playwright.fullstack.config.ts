import { defineConfig } from '@playwright/test';
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const origin = new URL(process.env.FULLSTACK_ORIGIN ?? 'https://127.0.0.1:1');
if (origin.protocol !== 'https:' || origin.hostname !== '127.0.0.1') {
	throw new Error('The full-stack fixture requires a loopback HTTPS origin');
}
const evidence = process.env.FULLSTACK_EVIDENCE;
if (!evidence) throw new Error('FULLSTACK_EVIDENCE is required');

// Chromium workers need the same trust as the page when fetching fixture chunks.
const certificate = new X509Certificate(
	readFileSync(join(dirname(evidence), 'certificates', 'fullchain.pem'))
);
const fixturePin = createHash('sha256')
	.update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
	.digest('base64');

export default defineConfig({
	testDir: 'tests/fullstack',
	workers: 1,
	retries: 0,
	timeout: 150_000,
	expect: { timeout: 20_000 },
	outputDir: evidence,
	use: {
		baseURL: origin.origin,
		ignoreHTTPSErrors: true,
		launchOptions: { args: [`--ignore-certificate-errors-spki-list=${fixturePin}`] },
		trace: 'on',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	}
});
