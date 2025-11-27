/**
 * Signal Protocol Backup & Restore
 *
 * Handles backend synchronization and key restoration
 *
 * @module crypto/signalBackup
 */

import type { EncryptedKeyBundle } from '$lib/types';
import type { IndexedDBSignalProtocolStore } from './signalStore';
import {
	exportSignalKeys,
	importSignalKeys,
	generateSignalIdentity,
	publishSignalPrekey
} from './signalKeyManager';
import { encryptKeySet, decryptKeySet } from './keyEncryption';
import { DB_NAME_PREFIX, DEFAULT_SIGNED_PREKEY_ID } from './signalConstants';
import { logger } from '$lib/services/dev-logger';
import { toError } from './signalUtils';

/**
 * Check if this device has encryption keys stored locally in IndexedDB
 *
 * @param store - IndexedDB store instance
 * @returns True if identity keypair and signed prekey exist
 */
export async function hasLocalKeys(store: IndexedDBSignalProtocolStore): Promise<boolean> {
	const identityKeyPair = await store.getIdentityKeyPair();
	const signedPreKey = await store.loadSignedPreKey(DEFAULT_SIGNED_PREKEY_ID);
	return !!(identityKeyPair && signedPreKey);
}

/**
 * Export and encrypt Signal keys for secure backend storage
 *
 * @param store - IndexedDB store instance
 * @param deviceId - Device ID for key isolation
 * @param password - Encryption password
 * @returns Encrypted key bundle safe for backend storage
 */
export async function exportAndEncryptSignalKeys(
	store: IndexedDBSignalProtocolStore,
	deviceId: string,
	password: string
): Promise<EncryptedKeyBundle> {
	logger.info('[SignalBackup] Exporting and encrypting keys for device:', deviceId);

	const plaintextKeys = await exportSignalKeys(store);
	const encryptedBundle = await encryptKeySet(plaintextKeys, password, deviceId);

	logger.info('[SignalBackup] Keys encrypted and ready for backend storage');
	return encryptedBundle;
}

/**
 * Decrypt and import Signal keys from backend
 *
 * @param store - IndexedDB store instance
 * @param encryptedBundle - Encrypted bundle from backend
 * @param password - Decryption password
 */
export async function decryptAndImportSignalKeys(
	store: IndexedDBSignalProtocolStore,
	encryptedBundle: EncryptedKeyBundle,
	password: string
): Promise<void> {
	logger.info('[SignalBackup] Decrypting and importing keys for device:', encryptedBundle.deviceId);

	const plaintextKeys = await decryptKeySet(encryptedBundle, password);
	await importSignalKeys(store, plaintextKeys);

	logger.info('[SignalBackup] Keys decrypted and imported successfully');
}

/**
 * Clear all Signal Protocol state for a user
 *
 * ⚠️ WARNING: This is destructive and cannot be undone!
 *
 * @param userId - User ID to clear state for
 */
export async function clearSignalState(userId: string): Promise<void> {
	const dbName = `${DB_NAME_PREFIX}${userId}`;

	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(dbName);

		request.onerror = () => reject(toError(request.error));

		request.onsuccess = () => {
			logger.info(`[SignalBackup] Deleted database ${dbName}`);
			resolve();
		};

		request.onblocked = () => {
			logger.warning(
				`[SignalBackup] Database ${dbName} deletion blocked - this can happen if other tabs are open`
			);
			resolve();
		};
	});
}

/**
 * Generate and publish a complete Signal Protocol identity
 *
 * @param store - IndexedDB store instance
 * @param apiBase - API base URL
 * @param userId - User ID
 * @param deviceId - Device ID
 * @returns Server response from publish operation
 */
export async function generateAndPublishIdentity(
	store: IndexedDBSignalProtocolStore,
	apiBase: string,
	userId: string,
	deviceId: string
) {
	const identity = await generateSignalIdentity(store);
	const bundle = identity._signalBundle;
	if (!bundle) {
		throw new Error('No generated prekey bundle available');
	}
	return publishSignalPrekey(apiBase, userId, deviceId, bundle);
}
