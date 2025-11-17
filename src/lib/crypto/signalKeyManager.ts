/**
 * Signal Protocol Key Management
 *
 * Handles key generation, import/export, and publication
 *
 * @module crypto/signalKeyManager
 */

import { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript';
import type { KeyPairType } from '@privacyresearch/libsignal-protocol-typescript';
import type {
	Identity,
	GeneratedIdentity,
	PublicPreKeyBundle,
	PublishPrekeyResponse,
	StoredSignedPreKey
} from './types';
import { isStoredSignedPreKey } from './types';
import type { SignalKeySet } from '$lib/types';
import { IndexedDBSignalProtocolStore } from './signalStore';
import { arrayBufferToBase64, base64ToArrayBuffer } from './signalUtils';
import {
	DEFAULT_DEVICE_ID,
	DEFAULT_SIGNED_PREKEY_ID,
	PREKEY_COUNT,
	MAX_PREKEY_SCAN
} from './signalConstants';
import { logger } from '$lib/services/dev-logger';

/**
 * Generate a complete Signal Protocol identity with all necessary keys
 *
 * All keys are stored in IndexedDB automatically.
 *
 * @param store - IndexedDB store instance
 * @returns Identity object with public/private keys and prekey bundle
 */
export async function generateSignalIdentity(
	store: IndexedDBSignalProtocolStore
): Promise<GeneratedIdentity> {
	const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
	const registrationId = KeyHelper.generateRegistrationId();

	// Generate one-time prekeys for forward secrecy
	const preKeys: Array<{ keyId: number; keyPair: KeyPairType<ArrayBuffer> }> = [];
	for (let i = 1; i <= PREKEY_COUNT; i++) {
		const pk = await KeyHelper.generatePreKey(i);
		preKeys.push(pk);
	}

	// Generate signed prekey (proves identity key ownership)
	const signedPreKey = await KeyHelper.generateSignedPreKey(
		identityKeyPair,
		DEFAULT_SIGNED_PREKEY_ID
	);

	// Store locally in IndexedDB
	await store.storeIdentityKeyPair(identityKeyPair);
	await store.storeLocalRegistrationId(registrationId);

	// Store signed prekey with proper type structure
	const signedPreKeyData: StoredSignedPreKey = {
		pubKey: signedPreKey.keyPair.pubKey,
		privKey: signedPreKey.keyPair.privKey,
		signature: signedPreKey.signature
	};
	await store.storeSignedPreKey(signedPreKey.keyId, signedPreKeyData);

	// Store all one-time prekeys
	for (const preKey of preKeys) {
		await store.storePreKey(preKey.keyId, preKey.keyPair);
	}

	// Build identity object for return (public/private keys as base64)
	const identity: Identity = {
		publicKey: arrayBufferToBase64(identityKeyPair.pubKey),
		privateKey: arrayBufferToBase64(identityKeyPair.privKey)
	};

	// Build prekey bundle for server publication (public keys only)
	const bundle: PublicPreKeyBundle = {
		identityKey: arrayBufferToBase64(identityKeyPair.pubKey),
		registrationId,
		signedPreKey: {
			id: signedPreKey.keyId,
			publicKey: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
			signature: arrayBufferToBase64(signedPreKey.signature)
		},
		preKeys: preKeys.map((pk) => ({
			id: pk.keyId,
			publicKey: arrayBufferToBase64(pk.keyPair.pubKey)
		}))
	};

	return Object.assign(identity, { _signalBundle: bundle });
}

/**
 * Publish Signal Protocol prekey bundle to backend
 *
 * @param apiBase - API base URL
 * @param userId - User ID
 * @param deviceId - Device ID for multi-device support
 * @param bundle - Prekey bundle containing public keys
 * @returns Server response
 */
export async function publishSignalPrekey(
	apiBase: string,
	userId: string,
	deviceId: string,
	bundle: PublicPreKeyBundle
): Promise<PublishPrekeyResponse> {
	const url = `${apiBase}/api/user/prekeys`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userId, deviceId, bundle }),
		credentials: 'include'
	});

	if (!response.ok) {
		throw new Error(`Failed to publish prekey: ${response.statusText}`);
	}

	return response.json() as Promise<PublishPrekeyResponse>;
}

/**
 * Export complete Signal key set for backup to backend
 *
 * ⚠️ SECURITY WARNING: This function returns PLAINTEXT keys!
 * Always wrap with encryptKeySet() before sending to backend.
 *
 * @param store - IndexedDB store instance
 * @returns Complete key set in plaintext
 */
export async function exportSignalKeys(store: IndexedDBSignalProtocolStore): Promise<SignalKeySet> {
	// Get identity key pair (required)
	const identityKeyPair = await store.getIdentityKeyPair();
	if (!identityKeyPair) {
		throw new Error('No identity key pair found');
	}

	// Get registration ID (required)
	const registrationId = await store.getLocalRegistrationId();
	if (registrationId === undefined) {
		throw new Error('No registration ID found');
	}

	// Get signed prekey (required, always stored with keyId 1)
	const signedPreKey = await store.loadSignedPreKey(DEFAULT_SIGNED_PREKEY_ID);
	if (!signedPreKey || !isStoredSignedPreKey(signedPreKey)) {
		throw new Error('No signed prekey found or invalid format');
	}

	// Get all one-time prekeys (scan up to MAX_PREKEY_SCAN)
	const preKeys: SignalKeySet['preKeys'] = [];
	for (let i = 1; i <= MAX_PREKEY_SCAN; i++) {
		const preKey = await store.loadPreKey(i);
		if (preKey) {
			preKeys.push({
				keyId: i,
				keyPair: {
					pubKey: arrayBufferToBase64(preKey.pubKey),
					privKey: arrayBufferToBase64(preKey.privKey)
				}
			});
		}
	}

	return {
		identityKeyPair: {
			pubKey: arrayBufferToBase64(identityKeyPair.pubKey),
			privKey: arrayBufferToBase64(identityKeyPair.privKey)
		},
		registrationId,
		signedPreKeyPair: {
			keyId: DEFAULT_SIGNED_PREKEY_ID,
			keyPair: {
				pubKey: arrayBufferToBase64(signedPreKey.pubKey),
				privKey: arrayBufferToBase64(signedPreKey.privKey)
			},
			signature: arrayBufferToBase64(signedPreKey.signature)
		},
		preKeys
	};
}

/**
 * Import and restore Signal keys from backend
 *
 * @param store - IndexedDB store instance
 * @param keySet - Complete key set (decrypted)
 */
export async function importSignalKeys(
	store: IndexedDBSignalProtocolStore,
	keySet: SignalKeySet
): Promise<void> {
	// Validate key set structure
	if (!keySet.identityKeyPair || !keySet.signedPreKeyPair || !Array.isArray(keySet.preKeys)) {
		throw new Error('Invalid key set structure');
	}

	// Store identity key pair
	await store.storeIdentityKeyPair({
		pubKey: base64ToArrayBuffer(keySet.identityKeyPair.pubKey),
		privKey: base64ToArrayBuffer(keySet.identityKeyPair.privKey)
	});

	// Store registration ID
	await store.storeLocalRegistrationId(keySet.registrationId);

	// Store signed prekey with proper type structure
	const signedPreKeyData: StoredSignedPreKey = {
		pubKey: base64ToArrayBuffer(keySet.signedPreKeyPair.keyPair.pubKey),
		privKey: base64ToArrayBuffer(keySet.signedPreKeyPair.keyPair.privKey),
		signature: base64ToArrayBuffer(keySet.signedPreKeyPair.signature)
	};
	await store.storeSignedPreKey(keySet.signedPreKeyPair.keyId, signedPreKeyData);

	// Store all one-time prekeys
	for (const preKey of keySet.preKeys) {
		await store.storePreKey(preKey.keyId, {
			pubKey: base64ToArrayBuffer(preKey.keyPair.pubKey),
			privKey: base64ToArrayBuffer(preKey.keyPair.privKey)
		});
	}

	logger.info('[SignalKeyManager] Successfully imported keys', {
		preKeyCount: keySet.preKeys.length
	});
}
