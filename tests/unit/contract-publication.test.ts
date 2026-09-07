import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
	mkdirSync,
	readFileSync,
	existsSync,
	copyFileSync,
	readdirSync,
	symlinkSync,
	renameSync,
	unlinkSync,
	openSync,
	fsyncSync,
	closeSync
} from 'node:fs';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import {
	acquireLock,
	formatError,
	publishSnapshot,
	releaseLock
} from '../../scripts/lib/atomic-contract-files.mjs';
import {
	canonicalJsonBytes,
	FRONTEND_ARTIFACT_PATHS,
	MANIFEST_RELATIVE_PATH,
	hashBytes,
	renderSnapshotManifest
} from '../../scripts/lib/contract-snapshot.mjs';
import { generateApiOperations, generateApiTypes } from '../../scripts/lib/openapi-to-types.mjs';

const tmpRoots: string[] = [];
const frontendRoot = resolve(import.meta.dirname, '../..');

function makeTmpDir(prefix: string) {
	const path = mkdtempSync(join(tmpdir(), prefix));
	tmpRoots.push(path);
	return path;
}

function runNode(
	script: string,
	args: string[],
	extraEnv: NodeJS.ProcessEnv = {},
	cwd: string = process.cwd()
) {
	const result = spawnSync(process.execPath, [script, ...args], {
		encoding: 'utf8',
		env: { ...process.env, ...extraEnv },
		cwd
	});
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		error: result.error
	};
}

function expectSuccessful(result: ReturnType<typeof runNode>) {
	expect(result.error).toBeUndefined();
	expect(result.status, result.stderr).toBe(0);
}

function writeJson(path: string, data: unknown) {
	writeFileSync(path, JSON.stringify(data, null, '\t') + '\n');
}

async function formatRepositoryJson(path: string, data: unknown) {
	const config = (await prettier.resolveConfig(path, { useCache: false })) ?? {};
	return Buffer.from(
		await prettier.format(JSON.stringify(data), { ...config, filepath: path, parser: 'json' })
	);
}

function syncDirectory(path: string) {
	const fd = openSync(path, 'r');
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

const artifactRelativePaths = FRONTEND_ARTIFACT_PATHS;
const manifestRelativePath = MANIFEST_RELATIVE_PATH;

type ArtifactDescriptor = {
	targetPath: string;
	content: string | Buffer;
};

type PublicationRequest = {
	lockPath: string;
	artifacts: ArtifactDescriptor[];
	manifestPath: string;
	manifestContent: string | Buffer;
	ownerToken: string;
	failpoint?: string;
	onEvent?: (event: { type: 'rename'; targetPath: string; kind: 'artifact' | 'manifest' }) => void;
};

type Round5PublicationRequest = PublicationRequest & {
	expectedDependencies?: Array<{ path: string; bytes: Buffer }>;
	beforeAcquire?: () => void;
	onResource?: (event: {
		kind: 'lock' | 'stage' | 'backup';
		path: string;
		identity: { dev: number; ino: number };
	}) => void;
	fsOps?: {
		openSync?: (path: string, flags: string | number, mode?: number) => number;
		writeFileSync?: (fd: number | string, bytes: Buffer) => void;
		fsyncSync?: (fd: number) => void;
		closeSync?: (fd: number) => void;
		fsyncDirectory?: (path: string) => void;
		renameSync?: (source: string, target: string) => void;
	};
};

type PublicationFixture = {
	root: string;
	lockPath: string;
	manifestPath: string;
	artifactPaths: string[];
	targetPaths: string[];
	sentinelPath: string;
	ownerToken: string;
};

type IntegrationFixture = {
	tempRoot: string;
	scriptsDir: string;
	backendDir: string;
	userOpenapi: string;
	manifestPath: string;
};

function literalSha256(bytes: Buffer) {
	return createHash('sha256').update(bytes).digest('hex');
}

function makePublicationFixture(): PublicationFixture {
	const root = makeTmpDir('contract-publisher-round4-');
	const artifactPaths = artifactRelativePaths.map((path) => resolve(root, path));
	const manifestPath = resolve(root, 'contracts/contract-snapshot.manifest.json');
	const lockPath = resolve(root, '.contract-publication.lock');

	for (const path of [...artifactPaths, manifestPath])
		mkdirSync(dirname(path), { recursive: true });
	for (const [index, path] of artifactPaths.entries()) {
		writeFileSync(path, Buffer.from(`prior-artifact-${index + 1}\n`));
	}
	writeFileSync(manifestPath, Buffer.from('prior-manifest\n'));

	const sentinelPath = resolve(root, 'foreign-sentinel.bin');
	writeFileSync(sentinelPath, Buffer.from('foreign sentinel bytes\n'));

	return {
		root,
		lockPath,
		manifestPath,
		artifactPaths,
		targetPaths: [...artifactPaths, manifestPath],
		sentinelPath,
		ownerToken: `round4-owner-${process.pid}-${tmpRoots.length}`
	};
}

function makePublicationRequest(fixture: PublicationFixture): PublicationRequest {
	const artifacts = fixture.artifactPaths.map((targetPath, index) => ({
		targetPath,
		content: Buffer.from(`next-artifact-${index + 1}\n`)
	}));
	const frontendArtifacts = Object.fromEntries(
		artifacts.map(({ targetPath, content }) => [
			relative(fixture.root, targetPath),
			literalSha256(content)
		])
	);
	const manifest = {
		schemaVersion: 1,
		backendCommit: 'round4-fixture',
		generatorVersion: 1,
		frontendArtifacts
	};

	return {
		lockPath: fixture.lockPath,
		artifacts,
		manifestPath: fixture.manifestPath,
		manifestContent: Buffer.from(`${JSON.stringify(manifest, null, '\t')}\n`),
		ownerToken: fixture.ownerToken
	};
}

function readTargetSnapshot(fixture: PublicationFixture) {
	return new Map(fixture.targetPaths.map((path) => [path, readFileSync(path)]));
}

function targetPathsForRoot(root: string) {
	return [...artifactRelativePaths, manifestRelativePath].map((path) => resolve(root, path));
}

function snapshotBytes(paths: string[]) {
	return new Map(paths.map((path) => [path, existsSync(path) ? readFileSync(path) : null]));
}

function expectByteMap(paths: string[], before: Map<string, Buffer | null>) {
	for (const path of paths) {
		const expected = before.get(path);
		if (expected === null) expect(existsSync(path)).toBe(false);
		else expect(readFileSync(path)).toEqual(expected);
	}
}

function writePriorSnapshot(root: string) {
	const paths = targetPathsForRoot(root);
	for (const [index, path] of paths.entries()) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, Buffer.from(`prior-integration-${index}\n`));
	}
	return paths;
}

function parseManifest(path: string) {
	return JSON.parse(readFileSync(path, 'utf8')) as {
		schemaVersion: number;
		backendCommit: string;
		generatorVersion: number;
		backendSources: Record<string, string>;
		frontendArtifacts: Record<string, string>;
	};
}

function initializeFrontendGit(root: string) {
	execFileSync('git', ['init'], { cwd: root, encoding: 'utf8' });
	execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root });
	execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
	execFileSync('git', ['add', ...artifactRelativePaths, manifestRelativePath], { cwd: root });
	execFileSync('git', ['commit', '-m', 'snapshot'], { cwd: root });
}

function makeIntegrationFixture(): IntegrationFixture {
	const tempRoot = makeTmpDir('contract-pub-');
	const scriptsDir = resolve(tempRoot, 'scripts');
	const contractsDir = resolve(tempRoot, 'contracts');
	const backendDir = resolve(tempRoot, 'backend');
	const userOpenapi = resolve(backendDir, 'user-service/openapi.json');
	const chatOpenapi = resolve(backendDir, 'chat-service/openapi.json');
	const manifestPath = resolve(tempRoot, MANIFEST_RELATIVE_PATH);

	mkdirSync(resolve(backendDir, 'user-service'), { recursive: true });
	mkdirSync(resolve(backendDir, 'chat-service'), { recursive: true });
	mkdirSync(resolve(scriptsDir, 'lib'), { recursive: true });
	mkdirSync(contractsDir, { recursive: true });
	mkdirSync(resolve(tempRoot, 'src/lib/generated'), { recursive: true });
	copyFileSync(resolve(frontendRoot, '.prettierrc'), resolve(tempRoot, '.prettierrc'));
	symlinkSync(resolve(frontendRoot, 'node_modules'), resolve(tempRoot, 'node_modules'), 'dir');

	writeJson(userOpenapi, {
		openapi: '3.0.3',
		info: { title: 'User Service', version: '1.0.0' },
		'x-service-id': 'user',
		'x-gateway-prefix': '/user',
		components: { schemas: {} },
		paths: {}
	});
	writeJson(chatOpenapi, {
		openapi: '3.0.3',
		info: { title: 'Chat Service', version: '1.0.0' },
		'x-service-id': 'chat',
		'x-gateway-prefix': '/chat',
		components: { schemas: {} },
		paths: {}
	});

	for (const file of [
		'scripts/lib/openapi-to-types.mjs',
		'scripts/lib/atomic-contract-files.mjs',
		'scripts/lib/contract-snapshot.mjs',
		'scripts/gen-api-types.mjs',
		'scripts/sync-api-contracts.mjs'
	]) {
		const target = resolve(scriptsDir, file.replace(/^scripts\//, ''));
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(resolve(frontendRoot, file), target);
	}

	execFileSync('git', ['init'], { cwd: backendDir, encoding: 'utf8' });
	execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: backendDir });
	execFileSync('git', ['config', 'user.name', 'Test'], { cwd: backendDir });
	execFileSync('git', ['add', '.'], { cwd: backendDir });
	execFileSync('git', ['commit', '-m', 'initial'], { cwd: backendDir });

	return {
		tempRoot,
		scriptsDir,
		backendDir,
		userOpenapi,
		manifestPath
	};
}

function listFiles(root: string): string[] {
	const paths: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) paths.push(...listFiles(path));
		else paths.push(path);
	}
	return paths;
}

function errorText(error: unknown): string {
	if (error instanceof AggregateError) {
		return [error.message, ...error.errors.map((cause) => errorText(cause))].join('\n');
	}
	if (error instanceof Error) return error.message;
	return String(error);
}

function captureError(action: () => void) {
	try {
		action();
	} catch (error) {
		return error;
	}
	return undefined;
}

function publishRound5(request: Round5PublicationRequest) {
	return publishSnapshot(request as unknown as Parameters<typeof publishSnapshot>[0]);
}

function expectUnchangedAfterFailure(
	fixture: PublicationFixture,
	before: Map<string, Buffer>,
	error: unknown,
	reason: string
) {
	expect(error).toBeDefined();
	expect(errorText(error)).toContain(reason);
	for (const path of fixture.targetPaths) expect(readFileSync(path)).toEqual(before.get(path));
	expect(readFileSync(fixture.sentinelPath)).toEqual(Buffer.from('foreign sentinel bytes\n'));
	expect(existsSync(fixture.lockPath)).toBe(false);
	expect(listFiles(fixture.root).some((path) => path.includes(fixture.ownerToken))).toBe(false);
}

afterEach(() => {
	for (const path of tmpRoots.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe('atomic contract publisher', () => {
	it('rejects invalid descriptors before acquiring the lock', () => {
		const invalidCases: Array<{
			reason: string;
			mutate: (request: PublicationRequest) => PublicationRequest;
		}> = [
			{
				reason: 'artifacts must be an array',
				mutate: (request) => ({ ...request, artifacts: null as unknown as ArtifactDescriptor[] })
			},
			{
				reason: 'targetPath must be an absolute non-empty string',
				mutate: (request) => ({
					...request,
					artifacts: [{ targetPath: '', content: 'next' }, ...request.artifacts.slice(1)]
				})
			},
			{
				reason: 'content must be a string or Buffer',
				mutate: (request) => ({
					...request,
					artifacts: [
						{ targetPath: request.artifacts[0].targetPath, content: null as unknown as Buffer },
						...request.artifacts.slice(1)
					]
				})
			},
			{
				reason: 'artifact targets must be unique',
				mutate: (request) => ({
					...request,
					artifacts: [
						request.artifacts[0],
						{ ...request.artifacts[1], targetPath: request.artifacts[0].targetPath },
						...request.artifacts.slice(2)
					]
				})
			},
			{
				reason: 'manifestPath must be distinct',
				mutate: (request) => ({ ...request, manifestPath: request.artifacts[0].targetPath })
			},
			{
				reason: 'manifestContent must be a string or Buffer',
				mutate: (request) => ({ ...request, manifestContent: null as unknown as Buffer })
			},
			{
				reason: 'ownerToken must be a safe non-empty string',
				mutate: (request) => ({ ...request, ownerToken: '' })
			}
		];

		for (const invalidCase of invalidCases) {
			const fixture = makePublicationFixture();
			const before = readTargetSnapshot(fixture);
			const error = captureError(() =>
				publishSnapshot(invalidCase.mutate(makePublicationRequest(fixture)))
			);
			expectUnchangedAfterFailure(fixture, before, error, invalidCase.reason);
		}
	});

	it('writes a token and PID to the lock and never releases foreign or malformed locks', () => {
		const fixture = makePublicationFixture();
		acquireLock(fixture.lockPath, fixture.ownerToken);
		const ownedLock = JSON.parse(readFileSync(fixture.lockPath, 'utf8')) as {
			token: string;
			pid: number;
		};
		expect(ownedLock).toEqual({ token: fixture.ownerToken, pid: process.pid });
		releaseLock(fixture.lockPath, fixture.ownerToken);
		expect(existsSync(fixture.lockPath)).toBe(false);

		const foreignLock = Buffer.from('{"token":"foreign-token","pid":424242}\n');
		writeFileSync(fixture.lockPath, foreignLock);
		releaseLock(fixture.lockPath, fixture.ownerToken);
		expect(readFileSync(fixture.lockPath)).toEqual(foreignLock);

		const malformedLock = Buffer.from('not-json-lock\n');
		writeFileSync(fixture.lockPath, malformedLock);
		releaseLock(fixture.lockPath, fixture.ownerToken);
		expect(readFileSync(fixture.lockPath)).toEqual(malformedLock);
	});

	it('fails on foreign lock contention without changing the snapshot or foreign files', () => {
		const fixture = makePublicationFixture();
		const foreignLock = Buffer.from('{"token":"foreign-token","pid":424242}\n');
		writeFileSync(fixture.lockPath, foreignLock);
		const before = readTargetSnapshot(fixture);
		const error = captureError(() => publishSnapshot(makePublicationRequest(fixture)));
		const text = errorText(error);
		expect(error).toBeDefined();
		expect(text).toContain('Publication lock already held');
		for (const path of fixture.targetPaths) expect(readFileSync(path)).toEqual(before.get(path));
		expect(readFileSync(fixture.lockPath)).toEqual(foreignLock);
		expect(readFileSync(fixture.sentinelPath)).toEqual(Buffer.from('foreign sentinel bytes\n'));
		expect(listFiles(fixture.root).some((path) => path.includes(fixture.ownerToken))).toBe(false);
	});

	it('rolls back a failure during staging byte-for-byte', () => {
		const fixture = makePublicationFixture();
		const before = readTargetSnapshot(fixture);
		const request = makePublicationRequest(fixture);
		request.failpoint = 'during-staging';
		const error = captureError(() => publishSnapshot(request));
		expectUnchangedAfterFailure(fixture, before, error, 'Injected staging failure');
	});

	it('rolls back a failure after all staging and before any rename', () => {
		const fixture = makePublicationFixture();
		const before = readTargetSnapshot(fixture);
		const request = makePublicationRequest(fixture);
		request.failpoint = 'after-staging-before-rename';
		const error = captureError(() => publishSnapshot(request));
		expectUnchangedAfterFailure(fixture, before, error, 'Injected pre-rename failure');
	});

	it('rolls back every target after the first artifact rename', () => {
		const fixture = makePublicationFixture();
		const before = readTargetSnapshot(fixture);
		const request = makePublicationRequest(fixture);
		request.failpoint = 'after-first-rename';
		const error = captureError(() => publishSnapshot(request));
		expectUnchangedAfterFailure(fixture, before, error, 'Injected post-rename failure');
	});

	it('renames all artifacts before the manifest and records independent final hashes', () => {
		const fixture = makePublicationFixture();
		const request = makePublicationRequest(fixture);
		const renameEvents: Array<{
			type: 'rename';
			targetPath: string;
			kind: 'artifact' | 'manifest';
		}> = [];
		request.onEvent = (event) => renameEvents.push(event);

		publishSnapshot(request);

		expect(renameEvents).toHaveLength(6);
		expect(renameEvents.slice(0, 5).every((event) => event.kind === 'artifact')).toBe(true);
		expect(renameEvents[5]).toEqual({
			type: 'rename',
			targetPath: fixture.manifestPath,
			kind: 'manifest'
		});

		const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf8')) as {
			frontendArtifacts: Record<string, string>;
		};
		for (const path of fixture.artifactPaths) {
			const finalBytes = readFileSync(path);
			expect(manifest.frontendArtifacts[relative(fixture.root, path)]).toBe(
				literalSha256(finalBytes)
			);
		}
		expect(existsSync(fixture.lockPath)).toBe(false);
		expect(listFiles(fixture.root).some((path) => path.includes(fixture.ownerToken))).toBe(false);
		expect(readFileSync(fixture.sentinelPath)).toEqual(Buffer.from('foreign sentinel bytes\n'));
	});
});

describe('contract publication atomicity', () => {
	let tempRoot: string;
	let scriptsDir: string;
	let backendDir: string;
	let manifestPath: string;

	beforeEach(() => {
		const fixture = makeIntegrationFixture();
		({ tempRoot, scriptsDir, backendDir, manifestPath } = fixture);
	});

	it('sync reads committed backend blobs and rejects dirty backend contract while ignoring unrelated dirty file', () => {
		const unrelatedFile = resolve(backendDir, 'unrelated.txt');
		writeFileSync(unrelatedFile, 'dirty');

		const result = runNode(resolve(scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			backendDir
		]);
		expect(result.status).toBe(0);

		const userSpecPath = resolve(backendDir, 'user-service/openapi.json');
		const original = readFileSync(userSpecPath, 'utf8');
		writeFileSync(userSpecPath, original + '\n// dirty');

		const result2 = runNode(resolve(scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			backendDir
		]);
		expect(result2.status).not.toBe(0);

		writeFileSync(userSpecPath, original);
		rmSync(unrelatedFile);
	});

	it('repeating valid sync/generation is deterministic and produces no Git diff', () => {
		const firstSync = runNode(resolve(scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			backendDir
		]);
		expectSuccessful(firstSync);
		const firstGeneration = runNode(resolve(scriptsDir, 'gen-api-types.mjs'), []);
		expectSuccessful(firstGeneration);
		const first = snapshotBytes(targetPathsForRoot(tempRoot));
		initializeFrontendGit(tempRoot);

		const secondSync = runNode(resolve(scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			backendDir
		]);
		expectSuccessful(secondSync);
		const secondGeneration = runNode(resolve(scriptsDir, 'gen-api-types.mjs'), []);
		expectSuccessful(secondGeneration);
		const check = runNode(resolve(scriptsDir, 'gen-api-types.mjs'), ['--check']);
		expectSuccessful(check);

		expectByteMap(targetPathsForRoot(tempRoot), first);
		const diff = spawnSync('git', ['diff', '--exit-code', '--', 'contracts', 'src/lib/generated'], {
			cwd: tempRoot,
			encoding: 'utf8'
		});
		expect(diff.status, diff.stderr).toBe(0);
	});

	it('runs absolute sync, generation, and check entrypoints from an unrelated cwd', () => {
		const syncScript = resolve(scriptsDir, 'sync-api-contracts.mjs');
		const generationScript = resolve(scriptsDir, 'gen-api-types.mjs');
		const unrelatedCwd = makeTmpDir('contract-unrelated-cwd-');
		const runFromUnrelatedCwd = (script: string, args: string[]) =>
			runNode(script, args, {}, unrelatedCwd);

		const firstSync = runFromUnrelatedCwd(syncScript, ['--backend-dir', backendDir]);
		expectSuccessful(firstSync);
		const firstGeneration = runFromUnrelatedCwd(generationScript, []);
		expectSuccessful(firstGeneration);
		const first = snapshotBytes(targetPathsForRoot(tempRoot));
		initializeFrontendGit(tempRoot);

		const firstCheck = runFromUnrelatedCwd(generationScript, ['--check']);
		expectSuccessful(firstCheck);
		const secondSync = runFromUnrelatedCwd(syncScript, ['--backend-dir', backendDir]);
		expectSuccessful(secondSync);
		const secondGeneration = runFromUnrelatedCwd(generationScript, []);
		expectSuccessful(secondGeneration);
		const secondCheck = runFromUnrelatedCwd(generationScript, ['--check']);
		expectSuccessful(secondCheck);

		expectByteMap(targetPathsForRoot(tempRoot), first);
		const diff = spawnSync('git', ['diff', '--exit-code', '--', 'contracts', 'src/lib/generated'], {
			cwd: tempRoot,
			encoding: 'utf8'
		});
		expect(diff.status, diff.stderr).toBe(0);
	});

	it('sync publishes all five artifacts with committed provenance and exact hashes', async () => {
		const result = runNode(resolve(scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			backendDir
		]);
		expect(result.status).toBe(0);

		const targetPaths = targetPathsForRoot(tempRoot);
		for (const path of targetPaths) expect(existsSync(path)).toBe(true);
		const manifest = parseManifest(manifestPath);
		expect(Object.keys(manifest.frontendArtifacts).sort()).toEqual(
			artifactRelativePaths.slice().sort()
		);
		expect(manifest.backendCommit).toBe(
			execFileSync('git', ['-C', backendDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
		);

		for (const sourcePath of ['chat-service/openapi.json', 'user-service/openapi.json']) {
			const raw = execFileSync('git', ['-C', backendDir, 'show', `HEAD:${sourcePath}`]);
			expect(manifest.backendSources[sourcePath]).toBe(literalSha256(raw));
			const copiedPath = resolve(
				tempRoot,
				sourcePath.startsWith('chat-service')
					? 'contracts/chat-service.openapi.json'
					: 'contracts/user-service.openapi.json'
			);
			expect(readFileSync(copiedPath)).toEqual(
				await formatRepositoryJson(copiedPath, JSON.parse(raw.toString('utf8')))
			);
		}

		for (const path of artifactRelativePaths) {
			expect(manifest.frontendArtifacts[path]).toBe(
				literalSha256(readFileSync(resolve(tempRoot, path)))
			);
		}
	});

	it('rejects each backend provenance mutation before changing the prior snapshot', () => {
		const cases: Array<{
			name: string;
			mutate: (fixture: IntegrationFixture) => void;
			reason: string;
		}> = [
			{
				name: 'dirty contract',
				mutate: (fixture) =>
					writeFileSync(
						fixture.userOpenapi,
						`${readFileSync(fixture.userOpenapi, 'utf8')}\n// dirty`
					),
				reason: 'Dirty backend contract'
			},
			{
				name: 'deleted tracked contract',
				mutate: (fixture) => rmSync(fixture.userOpenapi),
				reason: 'Deleted backend contract'
			},
			{
				name: 'untracked replacement',
				mutate: (fixture) => {
					execFileSync('git', ['rm', '--cached', '--quiet', 'user-service/openapi.json'], {
						cwd: fixture.backendDir
					});
					writeFileSync(fixture.userOpenapi, Buffer.from('{"replacement":true}\n'));
				},
				reason: 'not tracked'
			}
		];

		for (const testCase of cases) {
			const fixture = makeIntegrationFixture();
			const targetPaths = writePriorSnapshot(fixture.tempRoot);
			const before = snapshotBytes(targetPaths);
			testCase.mutate(fixture);
			const result = runNode(resolve(fixture.scriptsDir, 'sync-api-contracts.mjs'), [
				'--backend-dir',
				fixture.backendDir
			]);
			expect(result.status, testCase.name).not.toBe(0);
			expect(`${result.stdout}\n${result.stderr}`, testCase.name).toContain(
				'user-service/openapi.json'
			);
			expect(`${result.stdout}\n${result.stderr}`, testCase.name).toContain(testCase.reason);
			expectByteMap(targetPaths, before);
		}
	});

	it('normal generation preserves valid provenance and the complete manifest', () => {
		const sync = runNode(resolve(scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			backendDir
		]);
		expect(sync.status).toBe(0);
		const before = parseManifest(manifestPath);

		const generated = runNode(resolve(scriptsDir, 'gen-api-types.mjs'), []);
		expect(generated.status, generated.stderr).toBe(0);
		const after = parseManifest(manifestPath);
		expect(after.schemaVersion).toBe(1);
		expect(after.backendCommit).toBe(before.backendCommit);
		expect(after.generatorVersion).toBe(1);
		expect(after.backendSources).toEqual(before.backendSources);
		expect(Object.keys(after.frontendArtifacts).sort()).toEqual(
			artifactRelativePaths.slice().sort()
		);
		for (const path of artifactRelativePaths) {
			expect(after.frontendArtifacts[path]).toBe(
				literalSha256(readFileSync(resolve(tempRoot, path)))
			);
		}
	});

	it('check accepts a complete tracked snapshot without writing', () => {
		const sync = runNode(resolve(scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			backendDir
		]);
		expect(sync.status).toBe(0);
		const generated = runNode(resolve(scriptsDir, 'gen-api-types.mjs'), []);
		expect(generated.status).toBe(0);
		initializeFrontendGit(tempRoot);
		const targetPaths = targetPathsForRoot(tempRoot);
		const before = snapshotBytes(targetPaths);
		const result = runNode(resolve(scriptsDir, 'gen-api-types.mjs'), ['--check']);
		expect(result.status).toBe(0);
		expectByteMap(targetPaths, before);
	});

	it('check detects each stale, missing, deleted, and untracked artifact without writing', () => {
		const cases: Array<{
			name: string;
			mutate: (fixture: IntegrationFixture) => void;
			reason: string;
		}> = [
			{
				name: 'modified artifact',
				mutate: (fixture) => {
					const path = resolve(fixture.tempRoot, 'src/lib/generated/api.types.ts');
					writeFileSync(path, `${readFileSync(path, 'utf8')}\n// modified`);
				},
				reason: 'Modified artifact'
			},
			{
				name: 'stale manifest',
				mutate: (fixture) => {
					const manifest = parseManifest(fixture.manifestPath);
					manifest.frontendArtifacts[artifactRelativePaths[0]] = '0'.repeat(64);
					writeJson(fixture.manifestPath, manifest);
				},
				reason: 'Stale manifest'
			},
			{
				name: 'missing artifact',
				mutate: (fixture) => {
					const path = resolve(fixture.tempRoot, 'src/lib/generated/api.types.ts');
					execFileSync(
						'git',
						['rm', '--cached', '--quiet', path.slice(fixture.tempRoot.length + 1)],
						{
							cwd: fixture.tempRoot
						}
					);
					rmSync(path);
				},
				reason: 'Missing artifact'
			},
			{
				name: 'deleted tracked artifact',
				mutate: (fixture) => rmSync(resolve(fixture.tempRoot, 'src/lib/generated/api.types.ts')),
				reason: 'Deleted tracked artifact'
			},
			{
				name: 'untracked replacement',
				mutate: (fixture) => {
					const path = resolve(fixture.tempRoot, 'src/lib/generated/api.types.ts');
					execFileSync('git', ['rm', '--cached', '--quiet', 'src/lib/generated/api.types.ts'], {
						cwd: fixture.tempRoot
					});
					writeFileSync(path, Buffer.from('untracked replacement\n'));
				},
				reason: 'not tracked'
			}
		];

		for (const testCase of cases) {
			const fixture = makeIntegrationFixture();
			const sync = runNode(resolve(fixture.scriptsDir, 'sync-api-contracts.mjs'), [
				'--backend-dir',
				fixture.backendDir
			]);
			expect(sync.status, testCase.name).toBe(0);
			const generated = runNode(resolve(fixture.scriptsDir, 'gen-api-types.mjs'), []);
			expect(generated.status, testCase.name).toBe(0);
			initializeFrontendGit(fixture.tempRoot);
			const targetPaths = targetPathsForRoot(fixture.tempRoot);
			testCase.mutate(fixture);
			const before = snapshotBytes(targetPaths);
			const result = runNode(resolve(fixture.scriptsDir, 'gen-api-types.mjs'), ['--check']);
			expect(result.status, testCase.name).not.toBe(0);
			expect(`${result.stdout}\n${result.stderr}`, testCase.name).toContain(testCase.reason);
			expectByteMap(targetPaths, before);
		}
	});

	it('check fails closed on a foreign lock without changing any bytes', () => {
		const sync = runNode(resolve(scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			backendDir
		]);
		expect(sync.status).toBe(0);
		const generated = runNode(resolve(scriptsDir, 'gen-api-types.mjs'), []);
		expect(generated.status).toBe(0);
		const targetPaths = targetPathsForRoot(tempRoot);
		const before = new Map(targetPaths.map((path) => [path, readFileSync(path)]));
		const foreignLock = Buffer.from('{"token":"foreign-token","pid":424242}\n');
		const lockPath = resolve(tempRoot, '.contract-publication.lock');
		writeFileSync(lockPath, foreignLock);

		const result = runNode(resolve(scriptsDir, 'gen-api-types.mjs'), ['--check']);
		expect(result.status).not.toBe(0);
		expect(`${result.stdout}\n${result.stderr}`).toContain('Publication lock');
		expectByteMap(targetPaths, before);
		expect(readFileSync(lockPath)).toEqual(foreignLock);
	});
});

describe('contract publication fix round 5 regressions', () => {
	it.each([
		{
			name: 'semantic copied-contract edit',
			mutate: (fixture: IntegrationFixture) => {
				const path = resolve(fixture.tempRoot, 'contracts/user-service.openapi.json');
				const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
				value.info = { title: 'User Service', version: '2.0.0' };
				writeJson(path, value);
			},
			affected: 'contracts/user-service.openapi.json'
		},
		{
			name: 'formatting-only copied-contract edit',
			mutate: (fixture: IntegrationFixture) => {
				const path = resolve(fixture.tempRoot, 'contracts/chat-service.openapi.json');
				writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, 'utf8')), null, 2) + '\n');
			},
			affected: 'contracts/chat-service.openapi.json'
		},
		{
			name: 'changed source record',
			mutate: (fixture: IntegrationFixture) => {
				const path = resolve(fixture.tempRoot, 'contracts/source.json');
				const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
				value.backendCommit = 'f'.repeat(40);
				writeJson(path, value);
			},
			affected: 'contracts/source.json'
		}
	])(
		'$name is rejected before normal generation changes any snapshot byte',
		({ mutate, affected }) => {
			const fixture = makeIntegrationFixture();
			const sync = runNode(resolve(fixture.scriptsDir, 'sync-api-contracts.mjs'), [
				'--backend-dir',
				fixture.backendDir
			]);
			expect(sync.status).toBe(0);
			const targetPaths = targetPathsForRoot(fixture.tempRoot);
			mutate(fixture);
			const before = snapshotBytes(targetPaths);

			const result = runNode(resolve(fixture.scriptsDir, 'gen-api-types.mjs'), []);
			expect(result.status).not.toBe(0);
			expect(`${result.stdout}\n${result.stderr}`).toContain(affected);
			expect(`${result.stdout}\n${result.stderr}`).toContain('trusted sync');
			expectByteMap(targetPaths, before);
		}
	);

	it('derives backend provenance independently from the source record and rejects disagreement', () => {
		const fixture = makeIntegrationFixture();
		const sync = runNode(resolve(fixture.scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			fixture.backendDir
		]);
		expect(sync.status).toBe(0);
		initializeFrontendGit(fixture.tempRoot);
		const sourcePath = resolve(fixture.tempRoot, 'contracts/source.json');
		const targetPaths = targetPathsForRoot(fixture.tempRoot);
		const validCheck = runNode(resolve(fixture.scriptsDir, 'gen-api-types.mjs'), ['--check']);
		expectSuccessful(validCheck);
		const originalManifest = parseManifest(fixture.manifestPath);
		const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
			backendSources: Record<string, string>;
		};
		const manifest = parseManifest(fixture.manifestPath);
		expect(source.backendSources).toEqual(manifest.backendSources);

		const manifestWithAlteredHash = parseManifest(fixture.manifestPath);
		manifestWithAlteredHash.backendSources['chat-service/openapi.json'] = '0'.repeat(64);
		writeJson(fixture.manifestPath, manifestWithAlteredHash);
		let result = runNode(resolve(fixture.scriptsDir, 'gen-api-types.mjs'), ['--check']);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('backendSources');

		writeJson(fixture.manifestPath, originalManifest);
		const alteredSource = JSON.parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown>;
		(alteredSource.backendSources as Record<string, string>)['user-service/openapi.json'] =
			'f'.repeat(64);
		writeJson(sourcePath, alteredSource);
		const beforeSourceOnlyCheck = snapshotBytes(targetPaths);
		result = runNode(resolve(fixture.scriptsDir, 'gen-api-types.mjs'), ['--check']);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('backendSources');
		expectByteMap(targetPaths, beforeSourceOnlyCheck);
	});

	it.each([
		{
			name: 'source record with an extra provenance key',
			mutate: (fixture: IntegrationFixture) => {
				const path = resolve(fixture.tempRoot, 'contracts/source.json');
				const source = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
				source.untrusted = true;
				writeJson(path, source);
			},
			reason: 'contracts/source.json must contain exactly'
		},
		{
			name: 'source record missing a backend provenance key',
			mutate: (fixture: IntegrationFixture) => {
				const path = resolve(fixture.tempRoot, 'contracts/source.json');
				const source = JSON.parse(readFileSync(path, 'utf8')) as {
					backendSources: Record<string, string>;
				};
				delete source.backendSources['chat-service/openapi.json'];
				writeJson(path, source);
			},
			reason: 'contracts/source.json.backendSources must contain exactly'
		},
		{
			name: 'manifest with a malformed backend provenance hash',
			mutate: (fixture: IntegrationFixture) => {
				const manifest = parseManifest(fixture.manifestPath);
				manifest.backendSources['chat-service/openapi.json'] = 'not-a-hash';
				writeJson(fixture.manifestPath, manifest);
			},
			reason: 'lowercase SHA-256 hash'
		},
		{
			name: 'manifest with an extra backend provenance key',
			mutate: (fixture: IntegrationFixture) => {
				const manifest = parseManifest(fixture.manifestPath);
				manifest.backendSources.untrusted = '0'.repeat(64);
				writeJson(fixture.manifestPath, manifest);
			},
			reason: 'contracts/contract-snapshot.manifest.json.backendSources must contain exactly'
		},
		{
			name: 'stale backend commit in the source record',
			mutate: (fixture: IntegrationFixture) => {
				const path = resolve(fixture.tempRoot, 'contracts/source.json');
				const source = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
				source.backendCommit = 'f'.repeat(40);
				writeJson(path, source);
			},
			reason: 'backendCommit does not match the manifest'
		},
		{
			name: 'stale generator version in the manifest',
			mutate: (fixture: IntegrationFixture) => {
				const manifest = parseManifest(fixture.manifestPath);
				manifest.generatorVersion = 2;
				writeJson(fixture.manifestPath, manifest);
			},
			reason: 'generatorVersion must be 1'
		}
	])('$name fails closed without rewriting the mutated snapshot', ({ mutate, reason }) => {
		const fixture = makeIntegrationFixture();
		const sync = runNode(resolve(fixture.scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			fixture.backendDir
		]);
		expectSuccessful(sync);
		initializeFrontendGit(fixture.tempRoot);
		mutate(fixture);
		const targetPaths = targetPathsForRoot(fixture.tempRoot);
		const before = snapshotBytes(targetPaths);

		const result = runNode(resolve(fixture.scriptsDir, 'gen-api-types.mjs'), ['--check']);
		expect(result.status).not.toBe(0);
		expect(`${result.stdout}\n${result.stderr}`).toContain(reason);
		expectByteMap(targetPaths, before);
	});

	it('rejects a competing snapshot published after generation captured its dependencies', () => {
		const fixture = makePublicationFixture();
		const request = makePublicationRequest(fixture) as Round5PublicationRequest;
		const competing = makePublicationRequest(fixture);
		request.expectedDependencies = fixture.targetPaths.map((path) => ({
			path,
			bytes: readFileSync(path)
		}));
		request.beforeAcquire = () => publishSnapshot(competing);
		const error = captureError(() => publishRound5(request));
		expect(error).toBeDefined();
		expect(errorText(error)).toContain('Publication dependency changed');
		for (const path of fixture.targetPaths) {
			expect(readFileSync(path)).toEqual(
				path === fixture.manifestPath
					? competing.manifestContent
					: Buffer.from(`next-artifact-${fixture.artifactPaths.indexOf(path) + 1}\n`)
			);
		}
	});

	it('rejects A after an actual generator interleaving publishes coherent B', async () => {
		const fixture = makeIntegrationFixture();
		const generationScript = resolve(fixture.scriptsDir, 'gen-api-types.mjs');
		const initialSync = runNode(resolve(fixture.scriptsDir, 'sync-api-contracts.mjs'), [
			'--backend-dir',
			fixture.backendDir
		]);
		expectSuccessful(initialSync);
		const initialGeneration = runNode(generationScript, []);
		expectSuccessful(initialGeneration);
		initializeFrontendGit(fixture.tempRoot);

		const targetPaths = targetPathsForRoot(fixture.tempRoot);
		const sourcePath = resolve(fixture.tempRoot, 'contracts/source.json');
		const sourceA = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
			backendCommit: string;
			generatorVersion: number;
			backendSources: Record<string, string>;
		};
		const sourceB = { ...sourceA, backendCommit: 'b'.repeat(40) };
		const chatSpec = JSON.parse(
			readFileSync(resolve(fixture.tempRoot, 'contracts/chat-service.openapi.json'), 'utf8')
		);
		const userSpec = JSON.parse(
			readFileSync(resolve(fixture.tempRoot, 'contracts/user-service.openapi.json'), 'utf8')
		);
		const nextBytes = Object.fromEntries(
			artifactRelativePaths.map((path) => [path, readFileSync(resolve(fixture.tempRoot, path))])
		) as Record<string, Buffer>;
		nextBytes['contracts/source.json'] = await canonicalJsonBytes(sourceB, sourcePath);
		nextBytes['src/lib/generated/api.operations.ts'] = Buffer.from(
			generateApiOperations({ userSpec, chatSpec, source: sourceB })
		);
		nextBytes['src/lib/generated/api.types.ts'] = Buffer.from(
			generateApiTypes({ userSpec, chatSpec, source: sourceB })
		);
		nextBytes[MANIFEST_RELATIVE_PATH] = Buffer.from(
			await renderSnapshotManifest(
				{
					backendCommit: sourceB.backendCommit,
					backendSources: sourceB.backendSources,
					frontendArtifacts: Object.fromEntries(
						FRONTEND_ARTIFACT_PATHS.map((path) => [path, hashBytes(nextBytes[path])])
					)
				},
				resolve(fixture.tempRoot, MANIFEST_RELATIVE_PATH)
			)
		);

		const lockPath = resolve(fixture.tempRoot, '.contract-publication.lock');
		const open = fs.openSync;
		const savedArgv = process.argv;
		const savedExitCode = process.exitCode;
		let intercepted = false;
		let generatorExit = 0;
		try {
			fs.openSync = (path, flags, ...rest) => {
				if (
					!intercepted &&
					String(path).endsWith('/.contract-publication.lock') &&
					String(flags) === 'wx'
				) {
					intercepted = true;
					publishSnapshot({
						lockPath,
						artifacts: artifactRelativePaths.map((path) => ({
							targetPath: resolve(fixture.tempRoot, path),
							content: nextBytes[path]
						})),
						manifestPath: resolve(fixture.tempRoot, MANIFEST_RELATIVE_PATH),
						manifestContent: nextBytes[MANIFEST_RELATIVE_PATH]
					});
				}
				return open(path, flags, ...rest);
			};
			syncBuiltinESMExports();
			process.argv = [process.execPath, generationScript];
			await import(pathToFileURL(generationScript).href);
			generatorExit = Number(process.exitCode ?? 0);
		} finally {
			fs.openSync = open;
			syncBuiltinESMExports();
			process.argv = savedArgv;
			process.exitCode = savedExitCode;
		}

		expect(intercepted).toBe(true);
		expect(generatorExit).not.toBe(0);
		for (const path of targetPaths) {
			const relativePath =
				path === resolve(fixture.tempRoot, MANIFEST_RELATIVE_PATH)
					? MANIFEST_RELATIVE_PATH
					: relative(fixture.tempRoot, path);
			expect(readFileSync(path)).toEqual(nextBytes[relativePath]);
		}
		const check = runNode(generationScript, ['--check']);
		expectSuccessful(check);
	});

	it('uses installed Prettier output for nested canonical JSON decisions', async () => {
		const longRequired = 'a'.repeat(66);
		const value = {
			level1: {
				level2: {
					level3: {
						level4: {
							level5: {
								type: 'object',
								properties: { [longRequired]: { type: 'string' }, bbbbbbb: { type: 'string' } },
								required: [longRequired, 'b'.repeat(7)]
							}
						}
					}
				}
			}
		};
		const path = resolve(frontendRoot, 'contracts/nested-regression.json');
		const config = (await prettier.resolveConfig(path, { useCache: false })) ?? {};
		const expected = await prettier.format(JSON.stringify(value), {
			...config,
			filepath: path,
			parser: 'json'
		});
		expect(await canonicalJsonBytes(value, path)).toEqual(Buffer.from(expected));
	});

	it('reads both backend blobs from the commit captured before a HEAD move', async () => {
		const fixture = makeIntegrationFixture();
		const syncScript = resolve(fixture.scriptsDir, 'sync-api-contracts.mjs');
		const initial = runNode(syncScript, ['--backend-dir', fixture.backendDir]);
		expect(initial.status).toBe(0);
		const commitA = execFileSync('git', ['-C', fixture.backendDir, 'rev-parse', 'HEAD'], {
			encoding: 'utf8'
		}).trim();
		const userPath = fixture.userOpenapi;
		const userValue = JSON.parse(readFileSync(userPath, 'utf8')) as Record<string, unknown>;
		userValue.info = { title: 'User Service', version: '2.0.0' };
		writeJson(userPath, userValue);
		execFileSync('git', ['-C', fixture.backendDir, 'add', 'user-service/openapi.json']);
		execFileSync('git', ['-C', fixture.backendDir, 'commit', '-m', 'second contract']);
		const commitB = execFileSync('git', ['-C', fixture.backendDir, 'rev-parse', 'HEAD'], {
			encoding: 'utf8'
		}).trim();
		execFileSync('git', ['-C', fixture.backendDir, 'checkout', '--detach', commitA]);

		const bin = makeTmpDir('git-capture-');
		const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
		const wrapper = resolve(bin, 'git');
		const marker = resolve(bin, 'moved');
		writeFileSync(
			wrapper,
			`#!/bin/sh\n"${realGit}" "$@"\nstatus=$?\nif [ "$status" -eq 0 ] && [ "$3" = "rev-parse" ] && [ "$4" = "HEAD" ] && [ ! -e "${marker}" ]; then\n  touch "${marker}"\n  "${realGit}" -C "${fixture.backendDir}" checkout --detach "${commitB}" >/dev/null\nfi\nexit "$status"\n`
		);
		execFileSync('chmod', ['+x', wrapper]);

		const result = runNode(syncScript, ['--backend-dir', fixture.backendDir], {
			PATH: `${bin}:${process.env.PATH ?? ''}`
		});
		expect(result.status).toBe(0);
		const copiedUser = readFileSync(
			resolve(fixture.tempRoot, 'contracts/user-service.openapi.json')
		);
		const committedA = execFileSync('git', [
			'-C',
			fixture.backendDir,
			'show',
			`${commitA}:user-service/openapi.json`
		]);
		expect(copiedUser).toEqual(
			await formatRepositoryJson(
				resolve(fixture.tempRoot, 'contracts/user-service.openapi.json'),
				JSON.parse(committedA.toString('utf8'))
			)
		);
	});

	it('surfaces recursive causes and all independent syscall failures', () => {
		const scenarios: Array<{
			name: string;
			configure: (request: Round5PublicationRequest) => () => boolean;
			reason: string;
		}> = [
			{
				name: 'staging write EIO',
				configure: (request) => {
					let injected = false;
					const descriptors = new Map<number, string>();
					request.fsOps = {
						openSync: (path, flags, mode) => {
							const fd = openSync(path, flags, mode);
							descriptors.set(fd, path);
							return fd;
						},
						writeFileSync: (fd, bytes) => {
							if (
								!injected &&
								typeof fd === 'number' &&
								descriptors.get(fd)?.includes('.tmp-contract-publish-')
							) {
								injected = true;
								throw Object.assign(new Error('staging write EIO'), { code: 'EIO' });
							}
							writeFileSync(fd, bytes);
						}
					};
					return () => injected;
				},
				reason: 'staging write EIO'
			},
			{
				name: 'file fsync EIO',
				configure: (request) => {
					let injected = false;
					const descriptors = new Map<number, string>();
					request.fsOps = {
						openSync: (path, flags, mode) => {
							const fd = openSync(path, flags, mode);
							descriptors.set(fd, path);
							return fd;
						},
						fsyncSync: (fd) => {
							if (!injected && descriptors.get(fd)?.includes('.tmp-contract-publish-')) {
								injected = true;
								throw Object.assign(new Error('file fsync EIO'), { code: 'EIO' });
							}
							fsyncSync(fd);
						}
					};
					return () => injected;
				},
				reason: 'file fsync EIO'
			},
			{
				name: 'file close EIO',
				configure: (request) => {
					let injected = false;
					const descriptors = new Map<number, string>();
					request.fsOps = {
						openSync: (path, flags, mode) => {
							const fd = openSync(path, flags, mode);
							descriptors.set(fd, path);
							return fd;
						},
						closeSync: (fd) => {
							if (!injected && descriptors.get(fd)?.includes('.tmp-contract-publish-')) {
								injected = true;
								throw Object.assign(new Error('file close EIO'), { code: 'EIO' });
							}
							closeSync(fd);
							descriptors.delete(fd);
						}
					};
					return () => injected;
				},
				reason: 'file close EIO'
			}
		];

		for (const scenario of scenarios) {
			const fixture = makePublicationFixture();
			const before = readTargetSnapshot(fixture);
			const request = makePublicationRequest(fixture) as Round5PublicationRequest;
			const wasInjected = scenario.configure(request);
			const error = captureError(() => publishRound5(request));
			expect(error, scenario.name).toBeDefined();
			expect(errorText(error), scenario.name).toContain(scenario.reason);
			expect(wasInjected(), scenario.name).toBe(true);
			expectUnchangedAfterFailure(fixture, before, error, scenario.reason);
		}
	});

	it('reports directory fsync failure after rename and retains backup on rollback EIO', () => {
		const fixture = makePublicationFixture();
		const request = makePublicationRequest(fixture) as Round5PublicationRequest;
		request.failpoint = 'after-first-rename';
		let renamed = false;
		let backupPath: string | undefined;
		request.onResource = (event) => {
			if (event.kind === 'backup' && backupPath === undefined) backupPath = event.path;
		};
		request.fsOps = {
			renameSync: (source, target) => {
				if (source.includes('.bak-contract-publish-'))
					throw Object.assign(new Error('backup rename EIO'), { code: 'EIO' });
				renameSync(source, target);
				if (source.includes('.tmp-contract-publish-')) renamed = true;
			},
			fsyncDirectory: (path) => {
				if (renamed)
					throw Object.assign(new Error(`directory fsync EIO: ${path}`), { code: 'EIO' });
				syncDirectory(path);
			}
		};
		request.onEvent = (event) => {
			if (event.kind === 'artifact') renamed = true;
		};
		const error = captureError(() => publishRound5(request));
		expect(error).toBeDefined();
		expect(errorText(error)).toContain('directory fsync EIO');
		expect(errorText(error)).toContain('backup rename EIO');
		expect(errorText(error)).toContain('rollback');
		expect(backupPath).toBeDefined();
		expect(readFileSync(backupPath!)).toEqual(Buffer.from('prior-artifact-1\n'));
	});

	it('returns a nonzero CLI status with recursive rollback detail and recoverable backup bytes', () => {
		const fixture = makePublicationFixture();
		const harnessPath = resolve(fixture.root, 'rollback-failure.mjs');
		const publisherPath = resolve(frontendRoot, 'scripts/lib/atomic-contract-files.mjs');
		writeFileSync(
			harnessPath,
			`import { closeSync, fsyncSync, openSync, renameSync } from 'node:fs';
import { formatError, publishSnapshot } from ${JSON.stringify(publisherPath)};

const artifactPaths = ${JSON.stringify(fixture.artifactPaths)};
const manifestPath = ${JSON.stringify(fixture.manifestPath)};
const lockPath = ${JSON.stringify(fixture.lockPath)};
const ownerToken = ${JSON.stringify(`${fixture.ownerToken}-cli`)};
let renamed = false;
const fsOps = {
  renameSync(source, target) {
    if (source.includes('.bak-contract-publish-'))
      throw Object.assign(new Error('backup rename EIO'), { code: 'EIO' });
    renameSync(source, target);
    if (source.includes('.tmp-contract-publish-')) renamed = true;
  },
  fsyncDirectory(path) {
    if (renamed) throw Object.assign(new Error('directory fsync EIO: ' + path), { code: 'EIO' });
    const fd = openSync(path, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
};
try {
  publishSnapshot({
    lockPath,
    ownerToken,
    artifacts: artifactPaths.map((targetPath, index) => ({
      targetPath,
      content: Buffer.from('cli-artifact-' + (index + 1) + '\\n')
    })),
    manifestPath,
    manifestContent: Buffer.from('cli-manifest\\n'),
    fsOps
  });
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}
`
		);

		const result = runNode(harnessPath, []);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('directory fsync EIO');
		expect(result.stderr).toContain('backup rename EIO');
		expect(result.stderr).toContain('Publication rollback failed');
		expect(result.stderr).toContain('Recovery material preserved at:');
		const recoveryPathPrefix = `${fixture.artifactPaths[0]}.bak-contract-publish-`;
		const recoveryPaths = listFiles(fixture.root).filter((path) =>
			path.startsWith(recoveryPathPrefix)
		);
		expect(recoveryPaths.length).toBeGreaterThan(0);
		expect(readFileSync(recoveryPaths[0])).toEqual(Buffer.from('prior-artifact-1\n'));
	});

	it('preserves foreign backup replacements and surfaces ownership loss on success cleanup and rollback', () => {
		for (const failpoint of [undefined, 'after-first-rename']) {
			const fixture = makePublicationFixture();
			const request = makePublicationRequest(fixture) as Round5PublicationRequest;
			request.failpoint = failpoint;
			let replaced = false;
			let replacedPath: string | undefined;
			request.onResource = (event) => {
				if (event.kind === 'backup' && !replaced) {
					replaced = true;
					replacedPath = event.path;
					unlinkSync(event.path);
					writeFileSync(event.path, Buffer.from('foreign replacement\n'));
				}
			};
			const error = captureError(() => publishRound5(request));
			expect(error, String(failpoint)).toBeDefined();
			expect(errorText(error), String(failpoint)).toContain('Ownership lost');
			expect(replacedPath).toBeDefined();
			expect(readFileSync(replacedPath!)).toEqual(Buffer.from('foreign replacement\n'));
		}
	});

	it.each(['stage', 'backup', 'lock'] as const)(
		'surfaces ownership loss and preserves a foreign %s replacement',
		(kind) => {
			const fixture = makePublicationFixture();
			const request = makePublicationRequest(fixture) as Round5PublicationRequest;
			let replaced = false;
			let replacedPath: string | undefined;
			request.onResource = (event) => {
				if (event.kind === kind && !replaced) {
					replaced = true;
					replacedPath = event.path;
					unlinkSync(event.path);
					writeFileSync(event.path, Buffer.from('foreign replacement\n'));
				}
			};
			const error = captureError(() => publishRound5(request));
			expect(replacedPath, kind).toBeDefined();
			expect(error, kind).toBeDefined();
			expect(errorText(error), kind).toContain('Ownership lost');
			expect(readFileSync(replacedPath!), kind).toEqual(Buffer.from('foreign replacement\n'));
		}
	);

	it('surfaces ownership loss and preserves a foreign published-target replacement', () => {
		const fixture = makePublicationFixture();
		const request = makePublicationRequest(fixture) as Round5PublicationRequest;
		request.failpoint = 'after-first-rename';
		let replacedPath: string | undefined;
		request.onEvent = (event) => {
			if (event.kind === 'artifact' && replacedPath === undefined) {
				replacedPath = event.targetPath;
				unlinkSync(event.targetPath);
				writeFileSync(event.targetPath, Buffer.from('foreign replacement\n'));
			}
		};
		const error = captureError(() => publishRound5(request));
		expect(replacedPath).toBeDefined();
		expect(error).toBeDefined();
		expect(errorText(error)).toContain('Ownership lost');
		expect(readFileSync(replacedPath!)).toEqual(Buffer.from('foreign replacement\n'));
	});

	it('closes every descriptor exactly once after successful publication', () => {
		const fixture = makePublicationFixture();
		const request = makePublicationRequest(fixture) as Round5PublicationRequest;
		const opened: number[] = [];
		const closed: number[] = [];
		request.fsOps = {
			openSync: ((path: string, flags: string | number, mode?: number) => {
				const fd = openSync(path, flags as any, mode as any);
				opened.push(fd);
				return fd;
			}) as any,
			closeSync: ((fd: number) => {
				closed.push(fd);
				return closeSync(fd);
			}) as any
		};
		const error = captureError(() => publishRound5(request));
		expect(error).toBeUndefined();
		expect(opened.length).toBeGreaterThan(0);
		expect(closed.length, `opened ${opened.length} vs closed ${closed.length}`).toBe(opened.length);
		const openCounts = new Map<number, number>();
		for (const fd of opened) openCounts.set(fd, (openCounts.get(fd) ?? 0) + 1);
		const closeCounts = new Map<number, number>();
		for (const fd of closed) closeCounts.set(fd, (closeCounts.get(fd) ?? 0) + 1);
		for (const [fd, count] of openCounts) {
			expect(closeCounts.get(fd), `fd ${fd} close count`).toBe(count);
		}
		for (const [fd, count] of closeCounts) {
			expect(openCounts.get(fd), `fd ${fd} open count`).toBe(count);
		}
		expect(listFiles(fixture.root).some((path) => path.includes(fixture.ownerToken))).toBe(false);
		expect(existsSync(fixture.lockPath)).toBe(false);
	});

	it('surfaces ownership loss when a newly published target disappears before rollback', () => {
		const fixture = makePublicationFixture();
		const request = makePublicationRequest(fixture);
		request.failpoint = 'after-first-rename';
		request.onEvent = (event) => {
			if (event.kind === 'artifact') unlinkSync(event.targetPath);
		};
		const error = captureError(() => publishSnapshot(request));
		expect(error).toBeDefined();
		expect(errorText(error)).toContain('Ownership');
	});

	it('formats publication, rollback, aggregate, and cause details recursively', () => {
		const rollback = new Error('backup rename EIO', { cause: new Error('EIO syscall') });
		const failure = new AggregateError([rollback], 'Publication rollback failed');
		const formatted = formatError(new Error('Contract publication failed', { cause: failure }));
		expect(formatted).toContain('Contract publication failed');
		expect(formatted).toContain('Publication rollback failed');
		expect(formatted).toContain('backup rename EIO');
		expect(formatted).toContain('EIO syscall');
	});
});
