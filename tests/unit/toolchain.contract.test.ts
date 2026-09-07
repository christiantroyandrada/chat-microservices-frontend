import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
	packageManager?: string;
	engines?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

describe('frontend toolchain contract', () => {
	it('pins the same Node and pnpm versions used by CI', () => {
		expect(pkg.packageManager).toBe('pnpm@9.11.0');
		expect(pkg.engines).toEqual({ node: '>=22 <23', pnpm: '9.11.0' });
	});

	it('declares Storybook imports directly and ignores generated output', () => {
		expect(pkg.devDependencies?.['@storybook/svelte']).toMatch(/^\^10\./);

		const result = spawnSync('git', ['check-ignore', '-q', '--', 'storybook-static/'], {
			cwd: root
		});
		expect(result.status).toBe(0);
	});

	it('contains no Finder conflict-copy files', () => {
		const conflictCopies = readdirSync(resolve(root, 'src'), {
			recursive: true,
			withFileTypes: true
		})
			.filter((entry) => entry.isFile() && / 2\.[^.]+$/.test(entry.name))
			.map((entry) => entry.name);
		expect(conflictCopies).toEqual([]);
	});
});
