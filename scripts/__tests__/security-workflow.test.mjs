import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
