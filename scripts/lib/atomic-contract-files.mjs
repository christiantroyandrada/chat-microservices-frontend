import { createHash, randomBytes } from 'node:crypto';
import {
	closeSync,
	fsyncSync,
	fstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

/** @typedef {string | Buffer} ByteInput */
/** @typedef {{targetPath: string, content: ByteInput}} ArtifactDescriptor */
/** @typedef {{type: 'rename', targetPath: string, kind: 'artifact' | 'manifest'}} RenameEvent */
/** @typedef {{dev: number, ino: number}} FileIdentity */
/** @typedef {{dev: number, ino: number, nlink: number}} PinnedIdentity */
/** @typedef {{kind: 'lock' | 'stage' | 'backup', path: string, identity: FileIdentity}} ResourceEvent */
/**
 * Internal ownership record. The retained read/write descriptor pins the
 * inode: even if the path is unlinked and the number recycled, fstat(fd)
 * still names the original file, so replacement is always detectable.
 * @typedef {{kind: 'lock' | 'stage' | 'backup', path: string, identity: FileIdentity, fd: (number | undefined)}} OwnedResource
 */
/** @typedef {{path: string, bytes: ByteInput}} DependencyDescriptor */
/** @typedef {{
 * openSync: typeof openSync,
 * closeSync: typeof closeSync,
 * fsyncSync: typeof fsyncSync,
 * fstatSync: typeof fstatSync,
 * mkdirSync: typeof mkdirSync,
 * readFileSync: typeof readFileSync,
 * renameSync: typeof renameSync,
 * statSync: typeof statSync,
 * unlinkSync: typeof unlinkSync,
 * writeFileSync: typeof writeFileSync,
 * fsyncDirectory?: (path: string) => void
 * }} FsOperations */
/** @typedef {{
 * lockPath: string,
 * artifacts: ArtifactDescriptor[],
 * manifestPath: string,
 * manifestContent: ByteInput,
 * ownerToken?: string,
 * failpoint?: string,
 * expectedDependencies?: DependencyDescriptor[],
 * beforeAcquire?: () => void,
 * onEvent?: (event: RenameEvent) => void,
 * onResource?: (event: ResourceEvent) => void,
 * fsOps?: Partial<FsOperations>
 * }} PublicationInput */

export const LOCK_FILENAME = '.contract-publication.lock';
const TEMP_PREFIX = '.tmp-contract-publish-';
const BACKUP_PREFIX = '.bak-contract-publish-';
const UNSUPPORTED_DIRECTORY_FSYNC_ERRORS = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP']);

/** @param {ByteInput} bytes */
export const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {unknown} manifest */
export const renderManifest = (manifest) => `${JSON.stringify(manifest, null, '\t')}\n`;

/** @param {unknown} error */
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

/** @param {unknown} error */
function asError(error) {
	return error instanceof Error ? error : new Error(String(error), { cause: error });
}

/** @param {unknown} error */
export function formatError(error) {
	/** @type {string[]} */
	const lines = [];
	const visited = new Set();

	/** @param {unknown} value @param {string} prefix */
	function visit(value, prefix) {
		if (typeof value === 'object' && value !== null) {
			if (visited.has(value)) {
				lines.push(`${prefix}<circular error>`);
				return;
			}
			visited.add(value);
		}
		lines.push(`${prefix}${errorMessage(value)}`);
		if (value instanceof AggregateError) {
			for (const nested of value.errors) visit(nested, `${prefix}Cause: `);
		}
		if (value && typeof value === 'object' && 'cause' in value && value.cause !== undefined) {
			visit(value.cause, `${prefix}Cause: `);
		}
	}

	visit(error, '');
	return lines.join('\n');
}

/** @param {unknown} value */
function isBytes(value) {
	return typeof value === 'string' || Buffer.isBuffer(value);
}

/** @param {ByteInput} value */
function toBuffer(value) {
	return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
}

/** @param {import('node:fs').Stats} stats */
function identityFromStats(stats) {
	return { dev: stats.dev, ino: stats.ino };
}

/** @param {import('node:fs').Stats} stats */
function pinnedIdentityFromStats(stats) {
	return { dev: stats.dev, ino: stats.ino, nlink: stats.nlink };
}

/** @param {FileIdentity} left @param {FileIdentity} right */
function sameIdentity(left, right) {
	return left.dev === right.dev && left.ino === right.ino;
}

/**
 * True only when the path still names the exact file the descriptor pins.
 * Comparing link counts closes the inode-recycling hole: a replaced path
 * whose number was reused still differs because the pinned (now unlinked)
 * inode reports nlink 0 while any live path reports at least 1.
 * @param {PinnedIdentity} pinned @param {PinnedIdentity} current
 */
function samePinnedIdentity(pinned, current) {
	return pinned.dev === current.dev && pinned.ino === current.ino && pinned.nlink === current.nlink;
}

/** @param {FileIdentity} identity */
function identityText(identity) {
	return `${identity.dev}:${identity.ino}`;
}

/** @param {Partial<FsOperations> | undefined} overrides @returns {FsOperations} */
function makeFsOperations(overrides) {
	return {
		openSync,
		closeSync,
		fsyncSync,
		fstatSync,
		mkdirSync,
		readFileSync,
		renameSync,
		statSync,
		unlinkSync,
		writeFileSync,
		...overrides
	};
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function validateAbsolutePath(value, label) {
	if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value)) {
		throw new Error(`${label} must be an absolute non-empty string`);
	}
}

/** @param {unknown} ownerToken */
function validateOwnerToken(ownerToken) {
	if (
		typeof ownerToken !== 'string' ||
		ownerToken.length === 0 ||
		!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ownerToken)
	) {
		throw new Error('ownerToken must be a safe non-empty string');
	}
}

/** @param {unknown} error */
function errorCode(error) {
	if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
	return typeof error.code === 'string' ? error.code : undefined;
}

/** @param {PublicationInput} input */
function validatePublication(input) {
	const {
		lockPath,
		artifacts,
		manifestPath,
		manifestContent,
		ownerToken = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`,
		expectedDependencies = []
	} = input;
	validateAbsolutePath(lockPath, 'lockPath');
	if (!Array.isArray(artifacts)) throw new Error('artifacts must be an array');
	const targetPaths = new Set();
	const normalizedArtifacts = artifacts.map((descriptor, index) => {
		if (!descriptor || typeof descriptor !== 'object') {
			throw new Error(`artifacts[${index}] must be a descriptor`);
		}
		validateAbsolutePath(descriptor.targetPath, `artifacts[${index}].targetPath`);
		if (!isBytes(descriptor.content)) {
			throw new Error(`artifacts[${index}].content must be a string or Buffer`);
		}
		if (targetPaths.has(descriptor.targetPath)) {
			throw new Error('artifact targets must be unique');
		}
		targetPaths.add(descriptor.targetPath);
		return { targetPath: descriptor.targetPath, content: toBuffer(descriptor.content) };
	});

	validateAbsolutePath(manifestPath, 'manifestPath');
	if (targetPaths.has(manifestPath)) throw new Error('manifestPath must be distinct');
	if (!isBytes(manifestContent)) {
		throw new Error('manifestContent must be a string or Buffer');
	}
	validateOwnerToken(ownerToken);
	if (input.onEvent !== undefined && typeof input.onEvent !== 'function') {
		throw new Error('onEvent must be a function');
	}
	if (input.onResource !== undefined && typeof input.onResource !== 'function') {
		throw new Error('onResource must be a function');
	}
	if (input.beforeAcquire !== undefined && typeof input.beforeAcquire !== 'function') {
		throw new Error('beforeAcquire must be a function');
	}
	if (!Array.isArray(expectedDependencies))
		throw new Error('expectedDependencies must be an array');
	const dependencyPaths = new Set();
	const normalizedDependencies = expectedDependencies.map((dependency, index) => {
		if (!dependency || typeof dependency !== 'object') {
			throw new Error(`expectedDependencies[${index}] must be a descriptor`);
		}
		validateAbsolutePath(dependency.path, `expectedDependencies[${index}].path`);
		if (!isBytes(dependency.bytes)) {
			throw new Error(`expectedDependencies[${index}].bytes must be a string or Buffer`);
		}
		if (dependencyPaths.has(dependency.path)) throw new Error('dependency paths must be unique');
		dependencyPaths.add(dependency.path);
		return { path: dependency.path, bytes: toBuffer(dependency.bytes) };
	});
	return {
		...input,
		ownerToken,
		artifacts: normalizedArtifacts,
		manifestContent: toBuffer(manifestContent),
		expectedDependencies: normalizedDependencies
	};
}

/**
 * Idempotent: safe to call on every exit path; second calls are no-ops.
 * @param {OwnedResource} resource
 * @param {FsOperations} io
 */
function closeResourceFd(resource, io) {
	if (resource.fd === undefined) return;
	const fd = resource.fd;
	resource.fd = undefined;
	io.closeSync(fd);
}

/**
 * Pure ownership check: never closes the retained descriptor. Callers close
 * exactly once on their terminal paths (cleanup loops, release, rollback).
 * @param {OwnedResource} resource
 * @param {FsOperations} io
 * @param {string} label
 */
function verifyResourceOwnership(resource, io, label) {
	const pinned =
		resource.fd === undefined ? undefined : pinnedIdentityFromStats(io.fstatSync(resource.fd));
	let current;
	try {
		current = pinnedIdentityFromStats(io.statSync(resource.path));
	} catch (error) {
		if (errorCode(error) === 'ENOENT') {
			throw new Error(`Ownership lost for ${label} ${resource.path}: path is missing`, {
				cause: error
			});
		}
		throw new Error(`Failed to inspect owned ${label} ${resource.path}: ${errorMessage(error)}`, {
			cause: error
		});
	}
	if (pinned !== undefined) {
		if (!samePinnedIdentity(pinned, current)) {
			throw new Error(
				`Ownership lost for ${label} ${resource.path}: expected inode ${identityText(resource.identity)} (links ${pinned.nlink}), found ${current.dev}:${current.ino} (links ${current.nlink})`
			);
		}
		return;
	}
	if (!sameIdentity(resource.identity, current)) {
		throw new Error(
			`Ownership lost for ${label} ${resource.path}: expected inode ${identityText(resource.identity)}, found ${identityText(current)}`
		);
	}
}

/**
 * @param {OwnedResource} resource
 * @param {FsOperations} io
 * @param {string} label
 * @returns {boolean}
 */
function removeOwnedResource(resource, io, label) {
	let current;
	try {
		current = pinnedIdentityFromStats(io.statSync(resource.path));
	} catch (error) {
		closeResourceFd(resource, io);
		if (errorCode(error) === 'ENOENT') return false;
		throw new Error(`Failed to inspect owned ${label} ${resource.path}: ${errorMessage(error)}`, {
			cause: error
		});
	}
	if (resource.fd !== undefined) {
		const pinned = pinnedIdentityFromStats(io.fstatSync(resource.fd));
		if (!samePinnedIdentity(pinned, current)) {
			closeResourceFd(resource, io);
			throw new Error(
				`Ownership lost for ${label} ${resource.path}: expected inode ${identityText(resource.identity)} (links ${pinned.nlink}), found ${current.dev}:${current.ino} (links ${current.nlink})`
			);
		}
	} else if (!sameIdentity(resource.identity, current)) {
		throw new Error(
			`Ownership lost for ${label} ${resource.path}: expected inode ${identityText(resource.identity)}, found ${identityText(current)}`
		);
	}
	try {
		io.unlinkSync(resource.path);
	} finally {
		closeResourceFd(resource, io);
	}
	return true;
}

/** @param {OwnedResource} resource @param {FsOperations} io */
function ownedResourceExists(resource, io) {
	try {
		const current = pinnedIdentityFromStats(io.statSync(resource.path));
		if (resource.fd === undefined) return sameIdentity(resource.identity, current);
		return samePinnedIdentity(pinnedIdentityFromStats(io.fstatSync(resource.fd)), current);
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return false;
		return false;
	}
}

/**
 * @param {string} path
 * @param {FileIdentity} identity
 * @param {FsOperations} io
 * @param {string} label
 * @returns {boolean}
 */
function removeOwnedPath(path, identity, io, label) {
	let current;
	try {
		current = identityFromStats(io.statSync(path));
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return false;
		throw new Error(`Failed to inspect owned ${label} ${path}: ${errorMessage(error)}`, {
			cause: error
		});
	}
	if (!sameIdentity(current, identity)) {
		throw new Error(
			`Ownership lost for ${label} ${path}: expected inode ${identityText(identity)}, found ${identityText(current)}`
		);
	}
	io.unlinkSync(path);
	return true;
}

/**
 * Creates the file exclusively, then retains a read descriptor so the inode
 * stays pinned for ownership checks until the caller closes it. The pin is
 * opened before the write descriptor is released and cross-checked, leaving
 * no window for an undetected swap; releasing the write descriptor preserves
 * the original close timing for syscall-failure injection.
 * @param {string} path
 * @param {Buffer} bytes
 * @param {string} label
 * @param {FsOperations} io
 * @returns {{identity: FileIdentity, fd: number}}
 */
function exclusiveWrite(path, bytes, label, io) {
	let fd;
	let pinFd;
	let identity;
	let created = false;
	const causes = [];
	try {
		fd = io.openSync(path, 'wx', 0o644);
		created = true;
		identity = identityFromStats(io.fstatSync(fd));
		io.writeFileSync(fd, bytes);
		io.fsyncSync(fd);
		pinFd = io.openSync(path, 'r');
		const written = pinnedIdentityFromStats(io.fstatSync(fd));
		const pinned = pinnedIdentityFromStats(io.fstatSync(pinFd));
		if (!samePinnedIdentity(written, pinned)) {
			throw new Error(`Ownership lost for ${label} ${path}: file replaced during creation`);
		}
		io.closeSync(fd);
		fd = undefined;
		const retained = pinFd;
		pinFd = undefined;
		return { identity, fd: retained };
	} catch (error) {
		causes.push(asError(error));
		if (pinFd !== undefined) {
			try {
				io.closeSync(pinFd);
			} catch (closeError) {
				causes.push(asError(closeError));
			}
			pinFd = undefined;
		}
		if (fd !== undefined) {
			try {
				io.closeSync(fd);
			} catch (closeError) {
				causes.push(asError(closeError));
			}
		}
		if (created && identity !== undefined) {
			try {
				removeOwnedPath(path, identity, io, label);
			} catch (cleanupError) {
				causes.push(asError(cleanupError));
			}
		}
		if (causes.length > 1) {
			throw new AggregateError(causes, `Failed to write ${label} ${path}`);
		}
		throw new Error(`Failed to write ${label} ${path}: ${errorMessage(error)}`, {
			cause: error
		});
	}
}

/** @param {string} ownerToken */
function lockBytes(ownerToken) {
	return Buffer.from(`${JSON.stringify({ token: ownerToken, pid: process.pid })}\n`);
}

/**
 * @param {string} path
 * @param {string} ownerToken
 * @param {{fsOps?: Partial<FsOperations>, onResource?: (event: ResourceEvent) => void}} [options]
 * @returns {{path: string, identity: FileIdentity, fd: (number | undefined)}}
 */
export function acquireLock(path, ownerToken, options = {}) {
	validateAbsolutePath(path, 'lockPath');
	validateOwnerToken(ownerToken);
	const io = makeFsOperations(options.fsOps);
	const bytes = lockBytes(ownerToken);
	/** @type {OwnedResource} */
	const lock = { kind: 'lock', path, identity: { dev: 0, ino: 0 }, fd: undefined };
	let created = false;
	const causes = [];

	try {
		lock.fd = io.openSync(path, 'wx', 0o644);
		created = true;
		lock.identity = identityFromStats(io.fstatSync(lock.fd));
		io.writeFileSync(lock.fd, bytes);
		io.fsyncSync(lock.fd);
		options.onResource?.({ kind: 'lock', path, identity: lock.identity });
		verifyResourceOwnership(lock, io, 'publication lock');
		fsyncDirectory(dirname(path), io);
		const acquired = { path, identity: lock.identity, fd: lock.fd };
		lock.fd = undefined;
		return acquired;
	} catch (error) {
		if (errorCode(error) === 'EEXIST' && !created) {
			throw new Error(`Publication lock already held: ${path}`, { cause: error });
		}
		causes.push(asError(error));
		try {
			closeResourceFd(lock, io);
		} catch (closeError) {
			causes.push(asError(closeError));
		}
		if (created) {
			try {
				removeOwnedResource(lock, io, 'publication lock');
			} catch (cleanupError) {
				causes.push(asError(cleanupError));
			}
		}
		if (causes.length > 1) {
			throw new AggregateError(causes, `Failed to acquire publication lock ${path}`);
		}
		throw new Error(`Failed to acquire publication lock ${path}: ${errorMessage(error)}`, {
			cause: error
		});
	}
}

/**
 * @param {string} path
 * @param {string} ownerToken
 * @param {FileIdentity} [expectedIdentity]
 * @param {Partial<FsOperations>} [fsOverrides]
 * @param {number} [expectedFd] Retained lock descriptor from acquireLock; when
 * provided, ownership is verified against the pinned inode and the descriptor
 * is always closed before returning.
 */
export function releaseLock(path, ownerToken, expectedIdentity, fsOverrides, expectedFd) {
	if (typeof ownerToken !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ownerToken)) return;
	const io = makeFsOperations(fsOverrides);
	/** @type {OwnedResource} */
	const lock = {
		kind: 'lock',
		path,
		identity: expectedIdentity ?? { dev: 0, ino: 0 },
		fd: expectedFd
	};
	try {
		if (expectedIdentity !== undefined) verifyResourceOwnership(lock, io, 'publication lock');
		let data;
		try {
			data = JSON.parse(io.readFileSync(path, 'utf8'));
		} catch (error) {
			if (errorCode(error) === 'ENOENT' && expectedIdentity === undefined) return;
			if (errorCode(error) === 'ENOENT') {
				throw new Error(`Ownership lost for publication lock ${path}: path is missing`, {
					cause: error
				});
			}
			if (error instanceof SyntaxError) {
				if (expectedIdentity === undefined) return;
				throw new Error(`Ownership lost for publication lock ${path}: malformed lock`, {
					cause: error
				});
			}
			throw error;
		}
		if (data?.token !== ownerToken || data?.pid !== process.pid) {
			if (expectedIdentity === undefined) return;
			throw new Error(`Ownership lost for publication lock ${path}: token or PID changed`);
		}
		if (expectedIdentity !== undefined) verifyResourceOwnership(lock, io, 'publication lock');
		try {
			io.unlinkSync(path);
		} catch (error) {
			if (errorCode(error) !== 'ENOENT') throw error;
		}
	} finally {
		closeResourceFd(lock, io);
	}
}

/**
 * @param {string} targetPath
 * @param {string} prefix
 * @param {string} ownerToken
 */
function ownedPath(targetPath, prefix, ownerToken) {
	return `${targetPath}${prefix}${ownerToken}-${process.pid}-${randomBytes(6).toString('hex')}`;
}

/** @param {string} path @param {FsOperations} io */
function fsyncDirectory(path, io) {
	if (io.fsyncDirectory !== undefined) {
		io.fsyncDirectory(path);
		return;
	}
	let fd;
	let operationError;
	let closeError;

	try {
		fd = io.openSync(path, 'r');
		io.fsyncSync(fd);
	} catch (error) {
		operationError = error;
	} finally {
		if (fd !== undefined) {
			try {
				io.closeSync(fd);
			} catch (error) {
				closeError = error;
			}
		}
	}

	/** @param {unknown} error */
	const directoryFsyncUnsupported = (error) => {
		const code = errorCode(error);
		return (
			(code !== undefined && UNSUPPORTED_DIRECTORY_FSYNC_ERRORS.has(code)) ||
			(process.platform === 'win32' && code === 'EPERM')
		);
	};
	if (operationError && !directoryFsyncUnsupported(operationError)) {
		if (closeError && !directoryFsyncUnsupported(closeError)) {
			throw new AggregateError([operationError, closeError], `Failed to fsync directory ${path}`);
		}
		throw new Error(`Failed to fsync directory ${path}: ${errorMessage(operationError)}`, {
			cause: operationError
		});
	}
	if (closeError && !directoryFsyncUnsupported(closeError)) {
		throw new Error(`Failed to close directory ${path}: ${errorMessage(closeError)}`, {
			cause: closeError
		});
	}
}

/**
 * @param {string} targetPath
 * @param {FsOperations} io
 * @returns {{bytes: Buffer, identity: FileIdentity} | null}
 */
function readPrevious(targetPath, io) {
	try {
		const identity = identityFromStats(io.statSync(targetPath));
		return { bytes: Buffer.from(io.readFileSync(targetPath)), identity };
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return null;
		throw new Error(`Failed to read existing target ${targetPath}: ${errorMessage(error)}`, {
			cause: error
		});
	}
}

/**
 * @param {string} targetPath
 * @param {Buffer} content
 * @param {string} ownerToken
 * @param {OwnedResource[]} resources
 * @param {FsOperations} io
 * @param {((event: ResourceEvent) => void) | undefined} onResource
 * @returns {{targetPath: string, bytes: Buffer, previous: Buffer | null, stage: OwnedResource, backup: (OwnedResource | null), publishedIdentity?: FileIdentity, publishedFd?: number, restored?: boolean} | null}
 */
function prepareRecord(targetPath, content, ownerToken, resources, io, onResource) {
	io.mkdirSync(dirname(targetPath), { recursive: true });
	const previous = readPrevious(targetPath, io);
	if (previous !== null && previous.bytes.equals(content)) return null;

	const stagePath = ownedPath(targetPath, TEMP_PREFIX, ownerToken);
	const staged = exclusiveWrite(stagePath, content, 'staged file', io);
	const stage = /** @type {OwnedResource} */ ({
		kind: 'stage',
		path: stagePath,
		identity: staged.identity,
		fd: staged.fd
	});
	resources.push(stage);
	onResource?.({ kind: stage.kind, path: stage.path, identity: stage.identity });
	fsyncDirectory(dirname(targetPath), io);

	let backup = null;
	if (previous !== null) {
		const backupPath = ownedPath(targetPath, BACKUP_PREFIX, ownerToken);
		const written = exclusiveWrite(backupPath, previous.bytes, 'backup file', io);
		backup = /** @type {OwnedResource} */ ({
			kind: 'backup',
			path: backupPath,
			identity: written.identity,
			fd: written.fd
		});
		resources.push(backup);
		onResource?.({ kind: backup.kind, path: backup.path, identity: backup.identity });
		fsyncDirectory(dirname(targetPath), io);
	}
	return {
		targetPath,
		bytes: content,
		previous: previous?.bytes ?? null,
		stage,
		backup
	};
}

/**
 * @param {NonNullable<ReturnType<typeof prepareRecord>>} record
 * @param {'artifact' | 'manifest'} kind
 * @param {((event: RenameEvent) => void) | undefined} onEvent
 * @param {Array<NonNullable<ReturnType<typeof prepareRecord>>>} renamedRecords
 * @param {FsOperations} io
 */
function renameRecord(record, kind, onEvent, renamedRecords, io) {
	verifyResourceOwnership(record.stage, io, 'staged file');
	io.renameSync(record.stage.path, record.targetPath);
	record.publishedIdentity = record.stage.identity;
	record.publishedFd = record.stage.fd;
	record.stage.fd = undefined;
	renamedRecords.push(record);
	fsyncDirectory(dirname(record.targetPath), io);
	onEvent?.({ type: 'rename', targetPath: record.targetPath, kind });
}

/**
 * @param {Array<NonNullable<ReturnType<typeof prepareRecord>>>} records
 * @param {FsOperations} io
 * @returns {{errors: Error[], recoveryPaths: string[]}}
 */
function rollbackRecords(records, io) {
	const errors = [];
	const recoveryPaths = [];
	for (const record of records.slice().reverse()) {
		try {
			if (record.publishedIdentity === undefined) continue;
			verifyResourceOwnership(
				{
					kind: 'stage',
					path: record.targetPath,
					identity: record.publishedIdentity,
					fd: record.publishedFd
				},
				io,
				'published target'
			);
			if (record.previous === null) {
				io.unlinkSync(record.targetPath);
				record.restored = true;
			} else {
				if (record.backup === null) throw new Error(`Missing backup for ${record.targetPath}`);
				verifyResourceOwnership(record.backup, io, 'backup file');
				io.renameSync(record.backup.path, record.targetPath);
				record.restored = true;
			}
			fsyncDirectory(dirname(record.targetPath), io);
		} catch (error) {
			errors.push(
				new Error(`Failed to restore ${record.targetPath}: ${errorMessage(error)}`, {
					cause: error
				})
			);
			if (record.backup !== null && ownedResourceExists(record.backup, io)) {
				recoveryPaths.push(record.backup.path);
			}
		} finally {
			if (record.publishedFd !== undefined) {
				try {
					io.closeSync(record.publishedFd);
				} catch (closeError) {
					errors.push(asError(closeError));
				}
				record.publishedFd = undefined;
			}
		}
	}
	return { errors, recoveryPaths: [...new Set(recoveryPaths)] };
}

/**
 * @param {OwnedResource[]} resources
 * @param {boolean} preserveBackups
 * @param {FsOperations} io
 * @returns {{errors: Error[], recoveryPaths: string[]}}
 */
function cleanupResources(resources, preserveBackups, io) {
	const errors = [];
	const recoveryPaths = [];
	for (const resource of resources.slice().reverse()) {
		try {
			if (resource.kind === 'backup' && preserveBackups) {
				if (ownedResourceExists(resource, io)) {
					recoveryPaths.push(resource.path);
					continue;
				}
				try {
					verifyResourceOwnership(resource, io, 'backup file');
				} catch (error) {
					const cause = error instanceof Error ? error.cause : undefined;
					if (errorCode(cause) !== 'ENOENT') errors.push(asError(error));
				}
				continue;
			}
			removeOwnedResource(resource, io, `${resource.kind} file`);
		} catch (error) {
			errors.push(asError(error));
		} finally {
			try {
				closeResourceFd(resource, io);
			} catch (closeError) {
				errors.push(asError(closeError));
			}
		}
	}
	return { errors, recoveryPaths: [...new Set(recoveryPaths)] };
}

/** @param {DependencyDescriptor[]} dependencies @param {FsOperations} io */
function verifyDependencies(dependencies, io) {
	for (const dependency of dependencies) {
		let current;
		try {
			current = Buffer.from(io.readFileSync(dependency.path));
		} catch (error) {
			throw new Error(
				`Publication dependency changed: ${dependency.path}: ${errorMessage(error)}`,
				{
					cause: error
				}
			);
		}
		if (!current.equals(toBuffer(dependency.bytes))) {
			throw new Error(`Publication dependency changed: ${dependency.path}`);
		}
	}
}

/** @param {PublicationInput} input */
export function publishSnapshot(input) {
	const normalized = validatePublication(input);
	if (normalized.failpoint === 'before-validation') throw new Error('Injected validation failure');
	const io = makeFsOperations(normalized.fsOps);
	normalized.beforeAcquire?.();
	const lock = acquireLock(normalized.lockPath, normalized.ownerToken, {
		fsOps: normalized.fsOps,
		onResource: normalized.onResource
	});
	/** @type {OwnedResource[]} */
	const resources = [];
	/** @type {Array<NonNullable<ReturnType<typeof prepareRecord>>>} */
	const renamedRecords = [];
	/** @type {unknown | undefined} */
	let publicationError;
	/** @type {{errors: Error[], recoveryPaths: string[]}} */
	let rollbackResult = { errors: [], recoveryPaths: [] };

	try {
		verifyDependencies(normalized.expectedDependencies, io);
		const artifactRecords = [];
		for (const artifact of normalized.artifacts) {
			const record = prepareRecord(
				artifact.targetPath,
				artifact.content,
				normalized.ownerToken,
				resources,
				io,
				normalized.onResource
			);
			if (record !== null) artifactRecords.push(record);
			if (normalized.failpoint === 'during-staging') throw new Error('Injected staging failure');
		}
		const manifestRecord = prepareRecord(
			normalized.manifestPath,
			normalized.manifestContent,
			normalized.ownerToken,
			resources,
			io,
			normalized.onResource
		);
		if (normalized.failpoint === 'during-staging') throw new Error('Injected staging failure');
		if (normalized.failpoint === 'after-staging-before-rename') {
			throw new Error('Injected pre-rename failure');
		}

		for (const record of artifactRecords) {
			renameRecord(record, 'artifact', normalized.onEvent, renamedRecords, io);
			if (normalized.failpoint === 'after-first-rename') {
				throw new Error('Injected post-rename failure');
			}
		}
		if (manifestRecord !== null) {
			renameRecord(manifestRecord, 'manifest', normalized.onEvent, renamedRecords, io);
		}
	} catch (error) {
		publicationError = error;
		rollbackResult = rollbackRecords(renamedRecords, io);
	}

	const publishedCloseErrors = [];
	if (publicationError === undefined) {
		for (const record of renamedRecords) {
			if (record.publishedFd !== undefined) {
				try {
					io.closeSync(record.publishedFd);
				} catch (error) {
					publishedCloseErrors.push(asError(error));
				} finally {
					record.publishedFd = undefined;
				}
			}
		}
	}

	const cleanupResult = cleanupResources(resources, rollbackResult.errors.length > 0, io);
	let releaseError;
	try {
		releaseLock(lock.path, normalized.ownerToken, lock.identity, normalized.fsOps, lock.fd);
	} catch (error) {
		releaseError = error;
	}

	const causes = [];
	if (publicationError !== undefined) causes.push(asError(publicationError));
	if (rollbackResult.errors.length > 0) {
		causes.push(new AggregateError(rollbackResult.errors, 'Publication rollback failed'));
	}
	causes.push(...publishedCloseErrors);
	causes.push(...cleanupResult.errors);
	if (releaseError !== undefined) causes.push(asError(releaseError));
	const recoveryPaths = [
		...new Set([...rollbackResult.recoveryPaths, ...cleanupResult.recoveryPaths])
	];
	if (causes.length === 0) return;
	if (causes.length === 1 && publicationError !== undefined && recoveryPaths.length === 0) {
		throw publicationError;
	}
	const label =
		publicationError === undefined
			? 'Contract publication cleanup failed'
			: 'Contract publication failed';
	const recovery =
		recoveryPaths.length > 0 ? ` Recovery material preserved at: ${recoveryPaths.join(', ')}` : '';
	throw new AggregateError(causes, `${label}.${recovery}`);
}
