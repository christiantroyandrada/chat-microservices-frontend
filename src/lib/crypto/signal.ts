/**
 * Signal Protocol Implementation - Main Facade
 *
 * This module provides a unified API for Signal Protocol operations,
 * orchestrating functionality from specialized modules:
 * - signalStore: IndexedDB storage
 * - signalSession: Session management & encryption
 * - signalKeyManager: Key generation & management
 * - signalBackup: Backend sync & restore
 * - signalUtils: Helper functions
 *
 * Security Considerations:
 * - Private keys never leave IndexedDB unencrypted
 * - Backend storage uses client-side AES-256-GCM encryption
 * - User password required for key backup/restore (PBKDF2 with 100k iterations)
 * - Zero-knowledge architecture - server never sees plaintext keys
 *
 * @module crypto/signal
 */

import { IndexedDBSignalProtocolStore } from './signalStore';
import type { PublicPreKeyBundle, EncryptedMessage } from './types';
import type { SignalKeySet, EncryptedKeyBundle } from '$lib/types';
import * as Session from './signalSession';
import * as KeyManager from './signalKeyManager';
import * as Backup from './signalBackup';
import { logger } from '$lib/services/dev-logger';
import { shouldSkipBackup, markBackupDone } from '$lib/config';

// Re-export types for convenience
export type {
	Identity,
	GeneratedIdentity,
	PublicPreKeyBundle,
	EncryptedMessage,
	PublishPrekeyResponse
} from './types';

// Re-export error class for handling
export { SignalDecryptionError } from './signalSession';

// ============================================================================
// Global State Management
// ============================================================================

let store: IndexedDBSignalProtocolStore | null = null;
let initialized = false;
let currentUserId: string | null = null;
let initializationPromise: Promise<void> | null = null;
let restorePromise: Promise<boolean> | null = null;

/**
 * Check whether Signal has been fully initialized for the current user.
 * Used by the chat page to skip a redundant init when the login page already ran it.
 */
export function isSignalInitialized(): boolean {
	return initialized && store !== null;
}

// ============================================================================
// Core Initialization Functions
// ============================================================================

/**
 * Initialize Signal Protocol store for a user
 *
 * This function must be called before any Signal Protocol operations.
 * It creates or reuses an IndexedDB store for the specified user.
 *
 * @param userId - Optional user ID. Required for first initialization.
 * @returns Promise that resolves when initialization is complete
 * @throws Error if userId is not provided for first initialization
 */
export async function initSignal(userId?: string): Promise<void> {
	// If there's an ongoing initialization, wait for it to complete
	if (initializationPromise) {
		logger.info('[Signal] Waiting for ongoing initialization to complete...');
		await initializationPromise;
		if (userId && userId !== currentUserId) {
			// Need to re-initialize with different user
		} else {
			return;
		}
	}

	// If userId is provided and different from current, reinitialize store
	if (userId && userId !== currentUserId) {
		logger.info(`[Signal] Switching user from ${currentUserId} to ${userId}`);
		store = new IndexedDBSignalProtocolStore(userId);
		currentUserId = userId;
		initialized = false;
	}

	// If no store exists yet, we need a userId
	if (!store) {
		if (!userId) {
			throw new Error('initSignal requires userId parameter for first initialization');
		}
		store = new IndexedDBSignalProtocolStore(userId);
		currentUserId = userId;
	}

	if (initialized) return;

	// Create initialization promise to prevent concurrent calls
	initializationPromise = (async () => {
		try {
			await store.init();
			initialized = true;
			logger.info('[Signal] Initialization complete for userId:', currentUserId);
		} finally {
			initializationPromise = null;
		}
	})();

	await initializationPromise;
}

/**
 * Get the current store instance
 * @throws Error if not initialized
 */
function getStore(): IndexedDBSignalProtocolStore {
	if (!store) {
		throw new Error('Signal store not initialized. Call initSignal(userId) first.');
	}
	return store;
}

// ============================================================================
// Key Management Functions (Delegated to signalKeyManager)
// ============================================================================

/**
 * Generate a complete Signal Protocol identity with all necessary keys
 */
export async function generateSignalIdentity() {
	return KeyManager.generateSignalIdentity(getStore());
}

/**
 * Publish Signal Protocol prekey bundle to backend
 */
export async function publishSignalPrekey(
	apiBase: string,
	userId: string,
	deviceId: string,
	bundle: PublicPreKeyBundle
) {
	return KeyManager.publishSignalPrekey(apiBase, userId, deviceId, bundle);
}

/**
 * Generate and publish a complete Signal Protocol identity
 */
export async function generateAndPublishIdentity(
	apiBase: string,
	userId: string,
	deviceId: string
) {
	await initSignal(userId);
	return Backup.generateAndPublishIdentity(getStore(), apiBase, userId, deviceId);
}

// ============================================================================
// Session Management Functions (Delegated to signalSession)
// ============================================================================

/**
 * Create a Signal Protocol session with a remote user's prekey bundle
 */
export async function createSessionWithPrekeyBundle(prekeyBundle: unknown, currentUserId?: string) {
	await initSignal(currentUserId);
	return Session.createSessionWithPrekeyBundle(getStore(), prekeyBundle);
}

/**
 * Encrypt a plaintext message for a recipient
 */
export async function encryptMessage(
	recipientId: string,
	plaintext: string,
	currentUserId?: string
) {
	await initSignal(currentUserId);
	return Session.encryptMessage(getStore(), recipientId, plaintext);
}

/**
 * Decrypt a ciphertext message from a sender
 */
export async function decryptMessage(
	senderId: string,
	ciphertext: EncryptedMessage | string,
	currentUserId?: string
) {
	await initSignal(currentUserId);
	return Session.decryptMessage(getStore(), senderId, ciphertext);
}

/**
 * Check if we have an established session with a user
 */
export async function hasSession(targetUserId: string, currentUserId?: string): Promise<boolean> {
	await initSignal(currentUserId);
	return Session.hasSession(getStore(), targetUserId);
}

/**
 * Remove all sessions with a specific user
 */
export async function removeSessionWith(targetUserId: string, currentUserId: string) {
	await initSignal(currentUserId);
	return Session.removeSessionWith(getStore(), targetUserId);
}

// ============================================================================
// Backup & Restore Functions (Delegated to signalBackup)
// ============================================================================

/**
 * Check if this device has encryption keys stored locally
 */
export async function hasLocalKeys(userId?: string): Promise<boolean> {
	await initSignal(userId);
	return Backup.hasLocalKeys(getStore());
}

/**
 * Export Signal keys (plaintext - use with caution!)
 */
export async function exportSignalKeys(userId: string) {
	await initSignal(userId);
	return KeyManager.exportSignalKeys(getStore());
}

/**
 * Import Signal keys from backend
 */
export async function importSignalKeys(userId: string, keySet: SignalKeySet) {
	await initSignal(userId);
	return KeyManager.importSignalKeys(getStore(), keySet);
}

/**
 * Export and encrypt Signal keys for backend storage
 */
export async function exportAndEncryptSignalKeys(
	userId: string,
	deviceId: string,
	password: string
) {
	await initSignal(userId);
	return Backup.exportAndEncryptSignalKeys(getStore(), deviceId, password);
}

/**
 * Decrypt and import Signal keys from backend
 */
export async function decryptAndImportSignalKeys(
	userId: string,
	encryptedBundle: EncryptedKeyBundle,
	password: string
) {
	await initSignal(userId);
	return Backup.decryptAndImportSignalKeys(getStore(), encryptedBundle, password);
}

/**
 * Clear all Signal Protocol state for a user
 */
export async function clearSignalState(userId: string) {
	if (store && currentUserId === userId) {
		store.close();
		store = null;
		initialized = false;
		currentUserId = null;
	}
	return Backup.clearSignalState(userId);
}

/**
 * Initialize Signal Protocol with key restoration from backend if available
 */
export async function initSignalWithRestore(
	userId: string,
	deviceId: string,
	apiBase: string,
	encryptionPassword?: string
): Promise<boolean> {
	if (restorePromise) {
		logger.info('[Signal] Waiting for ongoing restore to complete...');
		return await restorePromise;
	}

	logger.info('[Signal] Initializing with restore for userId:', userId);

	restorePromise = (async () => {
		try {
			await initSignal(userId);

			logger.info('[Signal] Checking backend for authoritative encrypted keys...');
			try {
				const { authService } = await import('$lib/services/auth.service');
				const encryptedBundle = await authService.fetchSignalKeys(deviceId);

				// ── Path 1: Backend has encrypted keys AND we have a password → restore
				if (encryptedBundle && encryptionPassword) {
					logger.info('[Signal] Found encrypted keys on backend, decrypting and restoring...');

					// Clear data in-place via the existing connection instead of
					// deleting the entire database.  deleteDatabase fires onblocked
					// when the connection hasn't fully closed yet, creating a data
					// race where the deferred delete could wipe newly-imported keys.
					await getStore().clearAllData();

					await Backup.decryptAndImportSignalKeys(getStore(), encryptedBundle, encryptionPassword);
					logger.info('[Signal] Successfully decrypted and restored keys from backend');

					// Re-publish the prekey bundle so the server's public keys
					// match the private keys we just restored.  This prevents
					// "Bad MAC" errors caused by a stale public bundle that was
					// overwritten during a previous password-less initialisation.
					try {
						await Backup.republishPrekeys(getStore(), apiBase, userId, deviceId);
					} catch (republishErr) {
						logger.warning('[Signal] Failed to re-publish prekeys after restore:', republishErr);
					}

					return true;
				}

				// Helper: attempt a best-effort backup — 429 and transient errors are non-fatal.
				// Checks a client-side cooldown first to avoid running expensive PBKDF2
				// (100k iterations) only to receive a predictable 429 from the server.
				const tryBackup = async () => {
					if (!encryptionPassword) return;
					if (shouldSkipBackup()) {
						logger.info('[Signal] Skipping backup — cooldown not elapsed');
						return;
					}
					try {
						const encrypted = await Backup.exportAndEncryptSignalKeys(
							getStore(),
							deviceId,
							encryptionPassword
						);
						await authService.storeSignalKeys(deviceId, encrypted);
						markBackupDone();
						logger.info('[Signal] Successfully backed up encrypted keys to backend');
					} catch (backupErr) {
						const isRateLimited =
							backupErr instanceof Error &&
							((backupErr as { status?: number }).status === 429 ||
								backupErr.message.toLowerCase().includes('rate limit'));
						if (isRateLimited) {
							logger.warning(
								'[Signal] Key backup rate-limited — local keys are intact, backup will retry on next session'
							);
						} else {
							logger.error('[Signal] Key backup failed (non-fatal):', backupErr);
						}
					}
				};

				// ── Path 2: We already have local keys in IndexedDB → use them
				const hasKeys = await Backup.hasLocalKeys(getStore());

				if (hasKeys) {
					logger.info('[Signal] Found existing local keys');

					// Always re-publish the public prekey bundle so the server
					// is in sync with the private keys we hold locally.  Without
					// this, a stale server bundle (left over from a previous key
					// generation) causes "Bad MAC" for every incoming
					// PreKeyWhisperMessage because the peer encrypts against
					// public keys that no longer match our private keys.
					try {
						await Backup.republishPrekeys(getStore(), apiBase, userId, deviceId);
					} catch (republishErr) {
						logger.warning('[Signal] Failed to re-publish prekeys (non-fatal):', republishErr);
					}

					if (encryptionPassword) {
						logger.info('[Signal] Encrypting and backing up local keys to backend...');
						await tryBackup();
					} else {
						logger.warning('[Signal] No encryption password — using local keys without backup');
					}
					return true;
				}

				// ── Path 3: No keys anywhere → generate fresh keys
				logger.info('[Signal] No keys found anywhere, generating new keys...');
				await Backup.generateAndPublishIdentity(getStore(), apiBase, userId, deviceId);

				if (encryptionPassword) {
					logger.info('[Signal] Encrypting and backing up newly generated keys to backend...');
					await tryBackup();
				} else {
					logger.warning(
						'[Signal] No encryption password provided - keys will NOT be backed up to backend'
					);
				}

				return true;
			} catch (error) {
				logger.error('[Signal] Key initialization error:', error);

				const hasKeys = await Backup.hasLocalKeys(getStore());
				if (hasKeys) {
					logger.warning('[Signal] Falling back to local keys after initialization error');
					return true;
				}

				return false;
			}
		} finally {
			restorePromise = null;
		}
	})();

	return await restorePromise;
}

// ============================================================================
// Default Export for Backward Compatibility
// ============================================================================

export default {
	initSignal,
	hasLocalKeys,
	hasSession,
	generateSignalIdentity,
	publishSignalPrekey,
	generateAndPublishIdentity,
	createSessionWithPrekeyBundle,
	encryptMessage,
	decryptMessage,
	clearSignalState,
	removeSessionWith,
	initSignalWithRestore,
	exportSignalKeys,
	importSignalKeys
};
