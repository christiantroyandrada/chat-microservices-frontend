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
type RestoreAttempt = {
	userId: string;
	deviceId: string;
	hasPassword: boolean;
	promise: Promise<boolean>;
};
let activeRestore: RestoreAttempt | undefined;
let restoredDevice: { userId: string; deviceId: string } | undefined;
const pendingRestores = new Map<string, Promise<boolean>>();

/**
 * Check whether Signal has been fully initialized for the current user.
 * Used by the chat page to skip a redundant init when the login page already ran it.
 */
export function isSignalInitialized(userId: string, deviceId: string): boolean {
	return restoredDevice?.userId === userId && restoredDevice.deviceId === deviceId;
}

export function cancelSignalRestore() {
	activeRestore = undefined;
	restoredDevice = undefined;
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
	await initializedStore(userId);
}

async function initializedStore(userId?: string): Promise<IndexedDBSignalProtocolStore> {
	const owner = userId ?? currentUserId;
	if (!owner) throw new Error('initSignal requires userId parameter for first initialization');
	while (initializationPromise) {
		const initializingOwner = currentUserId;
		try {
			await initializationPromise;
		} catch (error) {
			if (owner === initializingOwner) throw error;
		}
	}

	if (!store || owner !== currentUserId) {
		store = new IndexedDBSignalProtocolStore(owner);
		currentUserId = owner;
		initialized = false;
	}

	const accountStore = store;
	if (!initialized) {
		initializationPromise = accountStore
			.init()
			.then(() => {
				initialized = store === accountStore;
			})
			.finally(() => {
				initializationPromise = null;
			});
		await initializationPromise;
	}
	return accountStore;
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
	return Backup.generateAndPublishIdentity(
		await initializedStore(userId),
		apiBase,
		userId,
		deviceId
	);
}

// ============================================================================
// Session Management Functions (Delegated to signalSession)
// ============================================================================

/**
 * Create a Signal Protocol session with a remote user's prekey bundle
 */
export async function createSessionWithPrekeyBundle(prekeyBundle: unknown, currentUserId?: string) {
	return Session.createSessionWithPrekeyBundle(await initializedStore(currentUserId), prekeyBundle);
}

/**
 * Encrypt a plaintext message for a recipient
 */
export async function encryptMessage(
	recipientId: string,
	plaintext: string,
	currentUserId?: string
) {
	return Session.encryptMessage(await initializedStore(currentUserId), recipientId, plaintext);
}

/**
 * Decrypt a ciphertext message from a sender
 */
export async function decryptMessage(
	senderId: string,
	ciphertext: EncryptedMessage | string,
	currentUserId?: string
) {
	return Session.decryptMessage(await initializedStore(currentUserId), senderId, ciphertext);
}

/**
 * Check if we have an established session with a user
 */
export async function hasSession(targetUserId: string, currentUserId?: string): Promise<boolean> {
	return Session.hasSession(await initializedStore(currentUserId), targetUserId);
}

/**
 * Remove all sessions with a specific user
 */
export async function removeSessionWith(targetUserId: string, currentUserId: string) {
	return Session.removeSessionWith(await initializedStore(currentUserId), targetUserId);
}

// ============================================================================
// Backup & Restore Functions (Delegated to signalBackup)
// ============================================================================

/**
 * Check if this device has encryption keys stored locally
 */
export async function hasLocalKeys(userId?: string): Promise<boolean> {
	return Backup.hasLocalKeys(await initializedStore(userId));
}

/**
 * Export Signal keys (plaintext - use with caution!)
 */
export async function exportSignalKeys(userId: string) {
	return KeyManager.exportSignalKeys(await initializedStore(userId));
}

/**
 * Import Signal keys from backend
 */
export async function importSignalKeys(userId: string, keySet: SignalKeySet) {
	return KeyManager.importSignalKeys(await initializedStore(userId), keySet);
}

/**
 * Export and encrypt Signal keys for backend storage
 */
export async function exportAndEncryptSignalKeys(
	userId: string,
	deviceId: string,
	password: string
) {
	return Backup.exportAndEncryptSignalKeys(await initializedStore(userId), deviceId, password);
}

/**
 * Decrypt and import Signal keys from backend
 */
export async function decryptAndImportSignalKeys(
	userId: string,
	encryptedBundle: EncryptedKeyBundle,
	password: string
) {
	return Backup.decryptAndImportSignalKeys(
		await initializedStore(userId),
		encryptedBundle,
		password
	);
}

/**
 * Clear all Signal Protocol state for a user
 */
export async function clearSignalState(userId: string) {
	if (activeRestore?.userId === userId || restoredDevice?.userId === userId) cancelSignalRestore();
	await pendingRestores.get(userId)?.catch(() => {});
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
	const hasPassword = Boolean(encryptionPassword);
	if (
		activeRestore?.userId === userId &&
		activeRestore.deviceId === deviceId &&
		(activeRestore.hasPassword || !hasPassword)
	) {
		return activeRestore.promise;
	}

	// Devices for the same account use one IndexedDB database.
	const previous = pendingRestores.get(userId);
	const isCurrent = () => activeRestore === attempt;
	const promise = Promise.resolve()
		.then(async () => {
			await previous?.catch(() => {});
			if (!isCurrent()) return false;
			const accountStore = await initializedStore(userId);

			try {
				const { authService } = await import('$lib/services/auth.service');
				if (!isCurrent()) return false;
				const bundle = await authService.fetchSignalKeys(deviceId, userId);
				if (!isCurrent()) return false;
				const hasKeys = await Backup.hasLocalKeys(accountStore);
				if (!isCurrent()) return false;

				if (hasKeys || bundle) {
					// A key backup has no sessions. Keep the existing database when it has local keys.
					if (!hasKeys && bundle) {
						if (!encryptionPassword) return false;
						await accountStore.clearAllData();
						if (!isCurrent()) return false;
						await Backup.decryptAndImportSignalKeys(accountStore, bundle, encryptionPassword);
					}
					if (!isCurrent()) return false;
					await Backup.republishPrekeys(accountStore, apiBase, userId, deviceId).catch((error) =>
						logger.warning('[Signal] Failed to re-publish prekeys:', error)
					);
				} else {
					await Backup.generateAndPublishIdentity(accountStore, apiBase, userId, deviceId);
				}

				if (isCurrent() && !bundle && encryptionPassword && !shouldSkipBackup(userId, deviceId)) {
					try {
						const encrypted = await Backup.exportAndEncryptSignalKeys(
							accountStore,
							deviceId,
							encryptionPassword
						);
						if (!isCurrent()) return false;
						await authService.storeSignalKeys(deviceId, encrypted, userId);
						markBackupDone(userId, deviceId);
					} catch (error) {
						logger.warning('[Signal] Key backup failed. Local keys are intact:', error);
					}
				}
				return true;
			} catch (error) {
				logger.error('[Signal] Key initialization error:', error);
				return isCurrent() && (await Backup.hasLocalKeys(accountStore));
			}
		})
		.then((success) => {
			if (!isCurrent()) return false;
			if (success) restoredDevice = { userId, deviceId };
			return success;
		})
		.finally(() => {
			if (isCurrent()) activeRestore = undefined;
			if (pendingRestores.get(userId) === promise) pendingRestores.delete(userId);
		});
	const attempt: RestoreAttempt = { userId, deviceId, hasPassword, promise };
	activeRestore = attempt;
	restoredDevice = undefined;
	pendingRestores.set(userId, promise);

	return promise;
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
