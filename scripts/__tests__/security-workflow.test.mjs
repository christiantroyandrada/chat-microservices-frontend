import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const root = resolve(import.meta.dirname, '../..');

function workflow(name) {
	return yaml.load(readFileSync(resolve(root, '.github', 'workflows', name), 'utf8'));
}

function auditStep(workflowFile, jobName, stepName) {
	const found = workflow(workflowFile).jobs[jobName].steps.find((step) => step.name === stepName);
	assert.ok(found, `missing ${stepName} step`);
	return found;
}

test('main and feature workflows fail on low-severity production advisories', () => {
	const mainAudit = auditStep('ci-main.yml', 'build-and-test', 'Audit dependencies');
	const featureAudit = auditStep('ci-feature.yml', 'build', 'Audit repo');

	for (const audit of [mainAudit, featureAudit]) {
		assert.equal(audit.run, 'pnpm audit --prod --audit-level=low');
		assert.doesNotMatch(audit.run, /\|\|\s*true/);
		assert.equal(audit['continue-on-error'], undefined);
	}
});

test('Sonar requires coverage and waits for the evaluated quality gate', () => {
	const ci = workflow('ci-main.yml');
	assert.equal(
		auditStep('ci-main.yml', 'build-and-test', 'Upload coverage artifact').with[
			'if-no-files-found'
		],
		'error'
	);
	assert.equal(auditStep('ci-main.yml', 'sonar', 'Checkout').with?.['fetch-depth'], 0);
	const scan = auditStep('ci-main.yml', 'sonar', 'SonarCloud Scan');
	assert.equal(scan['continue-on-error'], undefined);
	assert.ok(scan.with.args.includes('-Dsonar.qualitygate.wait=true'));
	assert.ok(
		ci.jobs['docker-build'].needs.includes('sonar'),
		'publication must not race a failing Sonar gate'
	);
});

test('registry writes are granted only to the image publication job', () => {
	const ci = workflow('ci-main.yml');
	for (const [name, job] of Object.entries(ci.jobs)) {
		const permissions = job.permissions ?? ci.permissions;
		assert.equal(
			permissions.packages ?? 'none',
			name === 'docker-build' ? 'write' : name === 'deploy' ? 'read' : 'none'
		);
		assert.equal(permissions.contents, 'read');
	}
});

test('Sonar classifies deployment fixtures as tests while retaining contract scripts as sources', () => {
	const args = auditStep('ci-main.yml', 'sonar', 'SonarCloud Scan').with.args;
	const properties = Object.fromEntries(
		[...args.matchAll(/-D([^=\s]+)=([^\s]+)/g)].map((match) => [match[1], match[2]])
	);
	assert.equal(properties['sonar.tests'], 'tests,scripts/__tests__');
	assert.equal(properties['sonar.test.inclusions'], 'tests/**,scripts/__tests__/**');
	assert.equal(properties['sonar.exclusions'], 'tests/**,test/**,__mocks__/**,mocks/**');
	assert.ok(properties['sonar.sources'] === undefined || properties['sonar.sources'] === '.');
});

test('Sonar receives the generated TypeScript config from the tested build', () => {
	const upload = auditStep('ci-main.yml', 'build-and-test', 'Upload Sonar TypeScript config');
	const download = auditStep('ci-main.yml', 'sonar', 'Download Sonar TypeScript config');
	assert.equal(upload.with.path, '.svelte-kit/tsconfig.json');
	assert.equal(upload.with['include-hidden-files'], true);
	assert.equal(upload.with['if-no-files-found'], 'error');
	assert.equal(download.with.name, upload.with.name);
	assert.equal(download.with.path, '.svelte-kit/');
});

test('coverage validation rejects absent and empty reports before accepting a real report', () => {
	const validate = auditStep('ci-main.yml', 'sonar', 'Validate coverage file');
	const directory = mkdtempSync(join(tmpdir(), 'frontend-coverage-'));
	try {
		const run = () => spawnSync('sh', ['-c', validate.run], { cwd: directory, encoding: 'utf8' });
		assert.notEqual(run().status, 0);
		mkdirSync(join(directory, 'coverage'));
		writeFileSync(join(directory, 'coverage/lcov.info'), '');
		assert.notEqual(run().status, 0);
		writeFileSync(
			join(directory, 'coverage/lcov.info'),
			'TN:\nSF:src/lib/services/api.ts\nDA:1,1\nend_of_record\n'
		);
		assert.notEqual(run().status, 0, 'missing generated TypeScript config must block analysis');
		mkdirSync(join(directory, '.svelte-kit'));
		writeFileSync(join(directory, '.svelte-kit/tsconfig.json'), '{"compilerOptions":{}}\n');
		const accepted = run();
		assert.equal(accepted.status, 0, accepted.stderr);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('the production image is scanned before registry publication', () => {
	const steps = workflow('ci-main.yml').jobs['docker-build'].steps;
	const build = steps.findIndex((step) => step.name === 'Build frontend for security scan');
	const scan = steps.findIndex((step) => step.name === 'Scan frontend image');
	const publish = steps.findIndex((step) => step.id === 'build-image');
	assert.ok(build >= 0 && scan > build && publish > scan);
	assert.equal(steps[build].with.push, false);
	assert.equal(steps[build].with.load, true);
	assert.equal(steps[scan].with['image-ref'], steps[build].with.tags);
	assert.equal(steps[scan].with['exit-code'], '1');
	assert.equal(steps[scan].with.severity, 'CRITICAL,HIGH');
	assert.equal(steps[scan]['continue-on-error'], undefined);
	assert.equal(steps[publish].if, undefined);
	assert.equal(steps[publish].uses, undefined, 'publication must not rebuild the scanned image');
	assert.ok(steps[publish].run.includes('docker tag chat-frontend:scan'));
	assert.ok(steps[publish].run.includes('docker push "$IMAGE_FRONTEND:$GITHUB_SHA"'));
	assert.ok(steps[publish].run.includes('echo "digest=$digest" >> "$GITHUB_OUTPUT"'));
});

test('publication promotes only the scanned image and rejects malformed registry digests', () => {
	const publish = workflow('ci-main.yml').jobs['docker-build'].steps.find(
		(step) => step.id === 'build-image'
	);
	const digest = `sha256:${'3'.repeat(64)}`;
	for (const manifest of [digest, 'sha256:malformed']) {
		const directory = mkdtempSync(join(tmpdir(), 'frontend-publication-'));
		try {
			const tags = join(directory, 'tags');
			const pushed = join(directory, 'pushed');
			const output = join(directory, 'output');
			writeFileSync(
				join(directory, 'docker'),
				`#!/bin/sh
case "$1" in
tag) [ "$2" = chat-frontend:scan ] || exit 3; printf '%s\\n' "$3" >> "$FAKE_TAGS" ;;
push) grep -Fxq "$2" "$FAKE_TAGS" || exit 4; printf '%s\\n' "$2" >> "$FAKE_PUSHED" ;;
image) printf '%s\\n' "$IMAGE_FRONTEND@$FAKE_MANIFEST" ;;
*) exit 5 ;;
esac
`,
				{ mode: 0o755 }
			);
			const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', publish.run], {
				encoding: 'utf8',
				env: {
					...process.env,
					PATH: `${directory}:${process.env.PATH}`,
					IMAGE_FRONTEND: 'ghcr.io/acme/chat-frontend',
					GITHUB_SHA: 'a'.repeat(40),
					GITHUB_OUTPUT: output,
					FAKE_TAGS: tags,
					FAKE_PUSHED: pushed,
					FAKE_MANIFEST: manifest
				}
			});
			if (manifest === digest) {
				assert.equal(result.status, 0, result.stderr);
				assert.equal(readFileSync(output, 'utf8'), `digest=${digest}\n`);
				assert.deepEqual(readFileSync(pushed, 'utf8').trim().split('\n'), [
					`ghcr.io/acme/chat-frontend:${'a'.repeat(40)}`,
					'ghcr.io/acme/chat-frontend:latest'
				]);
			} else {
				assert.notEqual(
					result.status,
					0,
					JSON.stringify({
						stdout: result.stdout,
						stderr: result.stderr,
						output: existsSync(output) ? readFileSync(output, 'utf8') : null
					})
				);
				assert.equal(existsSync(output), false);
				assert.ok(!readFileSync(pushed, 'utf8').includes(':latest'));
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}
});
