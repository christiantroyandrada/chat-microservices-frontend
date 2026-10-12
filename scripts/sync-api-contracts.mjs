#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateApiOperations, generateApiTypes } from './lib/openapi-to-types.mjs';
import {
	BACKEND_SOURCES,
	FRONTEND_ARTIFACT_PATHS,
	GENERATOR_VERSION,
	canonicalJsonBytes,
	hashBytes,
	parseJsonBytes,
	renderSnapshotManifest,
	resolveSnapshotPaths
} from './lib/contract-snapshot.mjs';
import { LOCK_FILENAME, formatError, publishSnapshot } from './lib/atomic-contract-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {import('./lib/contract-snapshot.mjs').BackendSource} BackendSource */
/** @typedef {import('./lib/openapi-to-types.mjs').OpenApiSpec} OpenApiSpec */
/** @typedef {{rawBytes: Buffer, document: unknown}} BackendDocument */
/** @typedef {{backendCommit: string, sources: Record<string, BackendDocument>}} BackendSnapshot */
/** @typedef {{artifacts: Record<string, string>, manifest: string}} SnapshotPaths */
/** @typedef {{beforeSourceReads?: (value: {backendCommit: string}) => void}} SnapshotHooks */
/** @typedef {Record<string, Buffer>} ArtifactContents */

function usageError() {
	return new Error('Usage: node scripts/sync-api-contracts.mjs --backend-dir <path>');
}

/** @param {string[]} args */
function parseArgs(args) {
	if (args.length !== 2 || args[0] !== '--backend-dir') throw usageError();
	return { backendDir: resolve(args[1]) };
}

/** @param {string} label @param {unknown} error */
function commandFailure(label, error) {
	return new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, {
		cause: error
	});
}

/** @param {string} backendDir @param {string[]} args @param {string} label @returns {string} */
function runGit(backendDir, args, label) {
	try {
		return execFileSync('/usr/bin/git', ['-C', backendDir, ...args], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
	} catch (error) {
		throw commandFailure(label, error);
	}
}

/** @param {string} backendDir @param {string} backendCommit @param {string} backendPath @returns {Buffer} */
function readGitBlob(backendDir, backendCommit, backendPath) {
	try {
		return execFileSync(
			'/usr/bin/git',
			['-C', backendDir, 'show', `${backendCommit}:${backendPath}`],
			{
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
	} catch (error) {
		throw commandFailure(`Failed to read committed backend blob ${backendPath}`, error);
	}
}

/** @param {string} backendDir */
function assertBackendRepository(backendDir) {
	try {
		const topLevel = execFileSync(
			'/usr/bin/git',
			['-C', backendDir, 'rev-parse', '--show-toplevel'],
			{
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		if (topLevel.trim().length === 0) throw new Error('empty repository root');
	} catch (error) {
		throw commandFailure(`Backend directory is not a Git repository: ${backendDir}`, error);
	}
}

/** @param {string} backendDir @param {string} backendPath */
function backendPathExists(backendDir, backendPath) {
	const path = resolve(backendDir, backendPath);
	try {
		return existsSync(path) && statSync(path).isFile();
	} catch (error) {
		throw commandFailure(`Failed to inspect backend contract ${backendPath}`, error);
	}
}

/** @param {string} backendDir @param {string} backendPath */
function assertTrackedBackendPath(backendDir, backendPath) {
	try {
		runGit(
			backendDir,
			['ls-files', '--error-unmatch', '--', backendPath],
			`Backend contract is not tracked: ${backendPath}`
		);
	} catch (error) {
		throw new Error(`Backend contract is not tracked: ${backendPath}`, { cause: error });
	}
}

/** @param {string} backendDir @param {string} backendPath */
function backendStatus(backendDir, backendPath) {
	return runGit(
		backendDir,
		['status', '--porcelain', '--untracked-files=all', '--', backendPath],
		`Failed to inspect backend contract status ${backendPath}`
	).trim();
}

/** @param {string} backendDir @param {string} backendPath */
function assertCleanBackendPath(backendDir, backendPath) {
	const status = backendStatus(backendDir, backendPath);
	if (status.length === 0) return;
	if (status.includes('D')) {
		throw new Error(`Deleted backend contract: ${backendPath}`);
	}
	throw new Error(`Dirty backend contract: ${backendPath}`);
}

/** @param {string} backendDir @param {string} backendCommit @param {BackendSource} source */
function readBackendSource(backendDir, backendCommit, source) {
	assertTrackedBackendPath(backendDir, source.backendPath);
	if (!backendPathExists(backendDir, source.backendPath)) {
		const status = backendStatus(backendDir, source.backendPath);
		if (status.length > 0) throw new Error(`Deleted backend contract: ${source.backendPath}`);
		throw new Error(`Missing backend contract: ${source.backendPath}`);
	}
	assertCleanBackendPath(backendDir, source.backendPath);
	const rawBytes = readGitBlob(backendDir, backendCommit, source.backendPath);
	const document = parseJsonBytes(rawBytes, source.backendPath);
	return { rawBytes, document };
}

/** @param {string} backendDir @param {SnapshotHooks} [hooks] */
export function readBackendSnapshot(backendDir, hooks = {}) {
	assertBackendRepository(backendDir);
	const backendCommit = runGit(
		backendDir,
		['rev-parse', 'HEAD'],
		'Failed to read backend HEAD'
	).trim();
	if (!/^[0-9a-f]{40}$/.test(backendCommit)) {
		throw new Error(`Backend HEAD is not an exact 40-hex commit: ${backendCommit}`);
	}
	hooks.beforeSourceReads?.({ backendCommit });

	const sources = Object.fromEntries(
		BACKEND_SOURCES.map((source) => [
			source.backendPath,
			readBackendSource(backendDir, backendCommit, source)
		])
	);
	return { backendCommit, sources };
}

/** @param {string} targetPath @param {() => string} render */
function renderGeneratedArtifact(targetPath, render) {
	try {
		return Buffer.from(render());
	} catch (error) {
		throw commandFailure(`Failed to render ${targetPath}`, error);
	}
}

/** @param {BackendSnapshot} snapshot @param {SnapshotPaths} paths @returns {Promise<ArtifactContents>} */
async function buildArtifactContents(snapshot, paths) {
	const backendSources = Object.fromEntries(
		BACKEND_SOURCES.map(({ backendPath }) => [
			backendPath,
			hashBytes(snapshot.sources[backendPath].rawBytes)
		])
	);
	const source = {
		backendCommit: snapshot.backendCommit,
		generatorVersion: GENERATOR_VERSION,
		backendSources
	};
	const chatDocument = /** @type {OpenApiSpec} */ (
		snapshot.sources['chat-service/openapi.json'].document
	);
	const userDocument = /** @type {OpenApiSpec} */ (
		snapshot.sources['user-service/openapi.json'].document
	);
	const generatedTypes = renderGeneratedArtifact(
		paths.artifacts['src/lib/generated/api.types.ts'],
		() => generateApiTypes({ userSpec: userDocument, chatSpec: chatDocument, source })
	);
	const generatedOperations = renderGeneratedArtifact(
		paths.artifacts['src/lib/generated/api.operations.ts'],
		() => generateApiOperations({ userSpec: userDocument, chatSpec: chatDocument, source })
	);

	return {
		'contracts/chat-service.openapi.json': await canonicalJsonBytes(
			chatDocument,
			paths.artifacts['contracts/chat-service.openapi.json']
		),
		'contracts/source.json': await canonicalJsonBytes(
			source,
			paths.artifacts['contracts/source.json']
		),
		'contracts/user-service.openapi.json': await canonicalJsonBytes(
			userDocument,
			paths.artifacts['contracts/user-service.openapi.json']
		),
		'src/lib/generated/api.operations.ts': generatedOperations,
		'src/lib/generated/api.types.ts': generatedTypes
	};
}

/** @param {BackendSnapshot} snapshot @param {ArtifactContents} artifactContents */
function createManifestInput(snapshot, artifactContents) {
	const frontendArtifacts = Object.fromEntries(
		FRONTEND_ARTIFACT_PATHS.map((path) => [path, hashBytes(artifactContents[path])])
	);
	return {
		backendCommit: snapshot.backendCommit,
		backendSources: Object.fromEntries(
			BACKEND_SOURCES.map(({ backendPath }) => [
				backendPath,
				hashBytes(snapshot.sources[backendPath].rawBytes)
			])
		),
		frontendArtifacts
	};
}

/** @param {BackendSnapshot} snapshot @param {string} rootPath */
async function publishFrontendSnapshot(snapshot, rootPath) {
	const paths = resolveSnapshotPaths(rootPath);
	const artifactContents = await buildArtifactContents(snapshot, paths);
	const manifestContent = await renderSnapshotManifest(
		createManifestInput(snapshot, artifactContents),
		paths.manifest
	);
	const artifacts = FRONTEND_ARTIFACT_PATHS.map((relativePath) => ({
		targetPath: paths.artifacts[relativePath],
		content: artifactContents[relativePath]
	}));

	publishSnapshot({
		lockPath: resolve(rootPath, LOCK_FILENAME),
		artifacts,
		manifestPath: paths.manifest,
		manifestContent
	});
}

export async function main(args = process.argv.slice(2), rootPath = root) {
	const { backendDir } = parseArgs(args);
	const snapshot = readBackendSnapshot(backendDir);
	await publishFrontendSnapshot(snapshot, rootPath);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
