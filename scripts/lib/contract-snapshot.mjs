import * as prettier from 'prettier';
import { createRequire } from 'node:module';
import { hashBytes } from './atomic-contract-files.mjs';
import { resolve } from 'node:path';

/** @typedef {{backendPath: string, frontendPath: string}} BackendSource */
/** @typedef {{backendCommit: string, generatorVersion: number, backendSources: Record<string, string>}} ContractSource */
/** @typedef {{schemaVersion: number, backendCommit: string, generatorVersion: number, backendSources: Record<string, string>, frontendArtifacts: Record<string, string>}} SnapshotManifest */
/** @typedef {{backendCommit: string, backendSources: Record<string, string>, frontendArtifacts: Record<string, string>}} ManifestInput */

export const GENERATOR_VERSION = 1;
export const MANIFEST_RELATIVE_PATH = 'contracts/contract-snapshot.manifest.json';

export const BACKEND_SOURCES = Object.freeze([
	Object.freeze({
		backendPath: 'chat-service/openapi.json',
		frontendPath: 'contracts/chat-service.openapi.json'
	}),
	Object.freeze({
		backendPath: 'user-service/openapi.json',
		frontendPath: 'contracts/user-service.openapi.json'
	})
]);

export const COPIED_CONTRACT_PATHS = Object.freeze([
	'contracts/chat-service.openapi.json',
	'contracts/source.json',
	'contracts/user-service.openapi.json'
]);

export const GENERATED_ARTIFACT_PATHS = Object.freeze([
	'src/lib/generated/api.operations.ts',
	'src/lib/generated/api.types.ts'
]);

export const FRONTEND_ARTIFACT_PATHS = Object.freeze([
	...COPIED_CONTRACT_PATHS,
	...GENERATED_ARTIFACT_PATHS
]);

const manifestKeys = [
	'schemaVersion',
	'backendCommit',
	'generatorVersion',
	'backendSources',
	'frontendArtifacts'
];
const sourceKeys = ['backendCommit', 'generatorVersion', 'backendSources'];
const hashPattern = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {readonly string[]} keys
 * @param {string} label
 */
function expectExactKeys(value, keys, label) {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	const actual = Object.keys(value);
	if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
		throw new Error(`${label} must contain exactly: ${keys.join(', ')}`);
	}
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function expectHash(value, label) {
	if (typeof value !== 'string' || !hashPattern.test(value)) {
		throw new Error(`${label} must be a lowercase SHA-256 hash`);
	}
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function expectCommit(value, label) {
	if (typeof value !== 'string' || !commitPattern.test(value)) {
		throw new Error(`${label} must be an exact 40-hex commit`);
	}
}

/** @param {string} root */
export function resolveSnapshotPaths(root) {
	const artifacts = Object.fromEntries(
		FRONTEND_ARTIFACT_PATHS.map((relativePath) => [relativePath, resolve(root, relativePath)])
	);
	return {
		artifacts,
		manifest: resolve(root, MANIFEST_RELATIVE_PATH)
	};
}

/**
 * @param {Buffer} bytes
 * @param {string} label
 * @returns {unknown}
 */
export function parseJsonBytes(bytes, label) {
	try {
		return JSON.parse(bytes.toString('utf8'));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new SyntaxError(`Invalid JSON in ${label}: ${message}`, { cause: error });
	}
}

/** @param {string} filepath @returns {Promise<Record<string, unknown>>} */
async function jsonFormatterOptions(filepath) {
	const config = (await prettier.resolveConfig(filepath, { useCache: false })) ?? {};
	if (!Array.isArray(config.plugins) || config.plugins.length === 0) {
		return { ...config, filepath, parser: 'json' };
	}
	const configPath = await prettier.resolveConfigFile(filepath);
	if (configPath === null) {
		throw new Error(
			`Cannot resolve configured Prettier plugins without a config file for ${filepath}`
		);
	}
	const requireFromConfig = createRequire(configPath);
	const plugins = config.plugins.map((plugin) => {
		if (typeof plugin !== 'string' || plugin.startsWith('file:')) return plugin;
		return requireFromConfig.resolve(plugin);
	});
	return { ...config, plugins, filepath, parser: 'json' };
}

/**
 * @param {unknown} value
 * @param {string} filepath
 * @returns {Promise<Buffer>}
 */
export async function canonicalJsonBytes(value, filepath) {
	const formatted = await prettier.format(
		JSON.stringify(value),
		await jsonFormatterOptions(filepath)
	);
	return Buffer.from(formatted.endsWith('\n') ? formatted : `${formatted}\n`);
}

/**
 * @param {unknown} source
 * @param {string} [label]
 * @returns {ContractSource}
 */
export function validateSource(source, label = 'contracts/source.json') {
	expectExactKeys(source, sourceKeys, label);
	const validSource = /** @type {ContractSource} */ (source);
	expectCommit(validSource.backendCommit, `${label}.backendCommit`);
	if (validSource.generatorVersion !== GENERATOR_VERSION) {
		throw new Error(`${label}.generatorVersion must be ${GENERATOR_VERSION}`);
	}
	const backendPaths = BACKEND_SOURCES.map(({ backendPath }) => backendPath);
	expectExactKeys(validSource.backendSources, backendPaths, `${label}.backendSources`);
	for (const path of backendPaths) {
		expectHash(validSource.backendSources[path], `${label}.backendSources.${path}`);
	}
	return validSource;
}

/**
 * @param {unknown} manifest
 * @param {string} [label]
 * @returns {SnapshotManifest}
 */
export function validateManifest(manifest, label = MANIFEST_RELATIVE_PATH) {
	expectExactKeys(manifest, manifestKeys, label);
	const validManifest = /** @type {SnapshotManifest} */ (manifest);
	if (validManifest.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
	expectCommit(validManifest.backendCommit, `${label}.backendCommit`);
	if (validManifest.generatorVersion !== GENERATOR_VERSION) {
		throw new Error(`${label}.generatorVersion must be ${GENERATOR_VERSION}`);
	}

	const backendPaths = BACKEND_SOURCES.map(({ backendPath }) => backendPath);
	expectExactKeys(validManifest.backendSources, backendPaths, `${label}.backendSources`);
	for (const path of backendPaths) {
		expectHash(validManifest.backendSources[path], `${label}.backendSources.${path}`);
	}

	expectExactKeys(
		validManifest.frontendArtifacts,
		FRONTEND_ARTIFACT_PATHS,
		`${label}.frontendArtifacts`
	);
	for (const path of FRONTEND_ARTIFACT_PATHS) {
		expectHash(validManifest.frontendArtifacts[path], `${label}.frontendArtifacts.${path}`);
	}
	return validManifest;
}

/** @param {ManifestInput} input */
export function buildManifest({ backendCommit, backendSources, frontendArtifacts }) {
	const manifest = {
		schemaVersion: 1,
		backendCommit,
		generatorVersion: GENERATOR_VERSION,
		backendSources: Object.fromEntries(
			BACKEND_SOURCES.map(({ backendPath }) => [backendPath, backendSources[backendPath]])
		),
		frontendArtifacts: Object.fromEntries(
			FRONTEND_ARTIFACT_PATHS.map((path) => [path, frontendArtifacts[path]])
		)
	};
	validateManifest(manifest);
	return manifest;
}

/** @param {ManifestInput} input @param {string} filepath */
export async function renderSnapshotManifest(input, filepath) {
	return (await canonicalJsonBytes(buildManifest(input), filepath)).toString('utf8');
}

export { hashBytes };
