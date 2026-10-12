#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateApiOperations, generateApiTypes } from './lib/openapi-to-types.mjs';
import {
	COPIED_CONTRACT_PATHS,
	FRONTEND_ARTIFACT_PATHS,
	GENERATED_ARTIFACT_PATHS,
	GENERATOR_VERSION,
	MANIFEST_RELATIVE_PATH,
	hashBytes,
	parseJsonBytes,
	renderSnapshotManifest,
	resolveSnapshotPaths,
	validateManifest,
	validateSource
} from './lib/contract-snapshot.mjs';
import { LOCK_FILENAME, formatError, publishSnapshot } from './lib/atomic-contract-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {import('./lib/openapi-to-types.mjs').OpenApiSpec} OpenApiSpec */
/** @typedef {import('./lib/contract-snapshot.mjs').ContractSource} ContractSource */
/** @typedef {{artifacts: Record<string, string>, manifest: string}} SnapshotPaths */
/** @typedef {{bytes: Record<string, Buffer>, manifest: import('./lib/contract-snapshot.mjs').SnapshotManifest, manifestBytes: Buffer, chatSpec: OpenApiSpec, source: ContractSource, userSpec: OpenApiSpec, paths: SnapshotPaths}} SnapshotState */
/** @typedef {Record<string, Buffer>} GeneratedArtifacts */

function usageError() {
	return new Error('Usage: node scripts/gen-api-types.mjs [--check]');
}

/** @param {string[]} args */
function parseArgs(args) {
	if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
		throw usageError();
	}
	return { check: args[0] === '--check' };
}

/** @param {string} path @param {string} relativePath */
function readArtifact(path, relativePath) {
	if (!existsSync(path)) throw new Error(`Missing artifact: ${relativePath}`);
	try {
		return readFileSync(path);
	} catch (error) {
		throw new Error(
			`Failed to read artifact ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
}

/** @param {string} label @param {unknown} error */
function commandFailure(label, error) {
	return new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, {
		cause: error
	});
}

/** @param {string} rootPath @param {string} relativePath */
function assertTracked(rootPath, relativePath) {
	try {
		execFileSync(
			'/usr/bin/git',
			['-C', rootPath, 'ls-files', '--error-unmatch', '--', relativePath],
			{
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
	} catch (error) {
		throw commandFailure(`Artifact is not tracked: ${relativePath}`, error);
	}
}

/** @param {SnapshotPaths} paths @param {string} rootPath */
function validateCheckFiles(paths, rootPath) {
	for (const relativePath of [...FRONTEND_ARTIFACT_PATHS, MANIFEST_RELATIVE_PATH]) {
		const path =
			relativePath === MANIFEST_RELATIVE_PATH ? paths.manifest : paths.artifacts[relativePath];
		if (!existsSync(path)) {
			try {
				assertTracked(rootPath, relativePath);
			} catch (error) {
				if (
					error instanceof Error &&
					error.cause &&
					typeof error.cause === 'object' &&
					'status' in error.cause
				) {
					throw new Error(`Missing artifact: ${relativePath}`, { cause: error });
				}
				throw error;
			}
			throw new Error(`Deleted tracked artifact: ${relativePath}`);
		}
		assertTracked(rootPath, relativePath);
	}
}

/** @param {OpenApiSpec} userSpec @param {OpenApiSpec} chatSpec @param {ContractSource} source */
function renderGenerated(userSpec, chatSpec, source) {
	let types;
	try {
		types = Buffer.from(generateApiTypes({ userSpec, chatSpec, source }));
	} catch (error) {
		throw new Error(`Failed to render ${GENERATED_ARTIFACT_PATHS[1]}`, { cause: error });
	}

	let operations;
	try {
		operations = Buffer.from(generateApiOperations({ userSpec, chatSpec, source }));
	} catch (error) {
		throw new Error(`Failed to render ${GENERATED_ARTIFACT_PATHS[0]}`, { cause: error });
	}

	return {
		[GENERATED_ARTIFACT_PATHS[0]]: operations,
		[GENERATED_ARTIFACT_PATHS[1]]: types
	};
}

/** @param {SnapshotPaths} paths */
function loadSnapshot(paths) {
	const bytes = Object.fromEntries(
		COPIED_CONTRACT_PATHS.map((relativePath) => [
			relativePath,
			readArtifact(paths.artifacts[relativePath], relativePath)
		])
	);
	const manifestBytes = readArtifact(paths.manifest, 'contracts/contract-snapshot.manifest.json');
	const chatSpec = /** @type {OpenApiSpec} */ (
		parseJsonBytes(
			bytes['contracts/chat-service.openapi.json'],
			'contracts/chat-service.openapi.json'
		)
	);
	const source = validateSource(
		parseJsonBytes(bytes['contracts/source.json'], 'contracts/source.json')
	);
	const userSpec = /** @type {OpenApiSpec} */ (
		parseJsonBytes(
			bytes['contracts/user-service.openapi.json'],
			'contracts/user-service.openapi.json'
		)
	);
	const manifest = validateManifest(
		parseJsonBytes(manifestBytes, 'contracts/contract-snapshot.manifest.json')
	);
	if (source.backendCommit !== manifest.backendCommit) {
		throw new Error(
			'contracts/source.json backendCommit does not match the manifest; run trusted sync'
		);
	}
	if (
		source.generatorVersion !== GENERATOR_VERSION ||
		source.generatorVersion !== manifest.generatorVersion
	) {
		throw new Error(
			'contracts/source.json generatorVersion does not match the manifest; run trusted sync'
		);
	}
	if (JSON.stringify(source.backendSources) !== JSON.stringify(manifest.backendSources)) {
		throw new Error(
			'contracts/source.json backendSources does not match the manifest; run trusted sync'
		);
	}
	return { bytes, manifest, manifestBytes, chatSpec, source, userSpec };
}

/** @param {SnapshotState} state */
function validateRetainedInputs(state) {
	for (const relativePath of COPIED_CONTRACT_PATHS) {
		const expectedHash = state.manifest.frontendArtifacts[relativePath];
		const actualHash = hashBytes(state.bytes[relativePath]);
		if (actualHash !== expectedHash) {
			throw new Error(
				`Retained input differs from manifest: ${relativePath}; run trusted sync before generation`
			);
		}
	}
}

/** @param {SnapshotState} state @param {GeneratedArtifacts} generated */
function frontendHashes(state, generated) {
	return Object.fromEntries(
		FRONTEND_ARTIFACT_PATHS.map((relativePath) => {
			const bytes =
				generated[relativePath] ??
				state.bytes[relativePath] ??
				readFileSync(state.paths.artifacts[relativePath]);
			return [relativePath, hashBytes(bytes)];
		})
	);
}

/** @param {SnapshotState} state @param {GeneratedArtifacts} generated */
async function checkSnapshot(state, generated) {
	const expectedGenerated = {
		[GENERATED_ARTIFACT_PATHS[0]]: generated[GENERATED_ARTIFACT_PATHS[0]],
		[GENERATED_ARTIFACT_PATHS[1]]: generated[GENERATED_ARTIFACT_PATHS[1]]
	};
	for (const relativePath of Object.keys(expectedGenerated)) {
		const actual = readFileSync(state.paths.artifacts[relativePath]);
		if (!actual.equals(expectedGenerated[relativePath])) {
			throw new Error(`Modified artifact: ${relativePath}`);
		}
	}

	const currentHashes = frontendHashes(state, generated);
	for (const relativePath of FRONTEND_ARTIFACT_PATHS) {
		if (currentHashes[relativePath] !== state.manifest.frontendArtifacts[relativePath]) {
			throw new Error(`Stale manifest: ${relativePath}`);
		}
	}

	const expectedManifest = await renderSnapshotManifest(
		{
			backendCommit: state.manifest.backendCommit,
			backendSources: state.source.backendSources,
			frontendArtifacts: currentHashes
		},
		state.paths.manifest
	);
	if (!state.manifestBytes.equals(Buffer.from(expectedManifest))) {
		throw new Error('Stale manifest: contracts/contract-snapshot.manifest.json');
	}
}

/** @param {SnapshotState} state @param {GeneratedArtifacts} generated @param {string} rootPath */
async function publishGenerated(state, generated, rootPath) {
	const manifestContent = await renderSnapshotManifest(
		{
			backendCommit: state.manifest.backendCommit,
			backendSources: state.source.backendSources,
			frontendArtifacts: frontendHashes(state, generated)
		},
		state.paths.manifest
	);
	publishSnapshot({
		lockPath: resolve(rootPath, LOCK_FILENAME),
		artifacts: [
			{
				targetPath: state.paths.artifacts[GENERATED_ARTIFACT_PATHS[0]],
				content: generated[GENERATED_ARTIFACT_PATHS[0]]
			},
			{
				targetPath: state.paths.artifacts[GENERATED_ARTIFACT_PATHS[1]],
				content: generated[GENERATED_ARTIFACT_PATHS[1]]
			}
		],
		manifestPath: state.paths.manifest,
		manifestContent,
		expectedDependencies: [
			...COPIED_CONTRACT_PATHS.map((relativePath) => ({
				path: state.paths.artifacts[relativePath],
				bytes: state.bytes[relativePath]
			})),
			{ path: state.paths.manifest, bytes: state.manifestBytes }
		]
	});
}

export async function main(args = process.argv.slice(2), rootPath = root) {
	const { check } = parseArgs(args);
	const paths = resolveSnapshotPaths(rootPath);
	if (check) {
		const lockPath = resolve(rootPath, LOCK_FILENAME);
		if (existsSync(lockPath)) throw new Error(`Publication lock exists: ${lockPath}`);
		validateCheckFiles(paths, rootPath);
	}
	const state = { ...loadSnapshot(paths), paths };
	if (!check) validateRetainedInputs(state);
	const generated = renderGenerated(state.userSpec, state.chatSpec, state.source);
	if (check) {
		await checkSnapshot(state, generated);
		return;
	}
	await publishGenerated(state, generated, rootPath);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
