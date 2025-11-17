/**
 * Signal Protocol Implementation for End-to-End Encryption
 *
 * This module provides a complete implementation of the Signal Protocol using
 * @privacyresearch/libsignal-protocol-typescript for browser-based E2EE messaging.
 *
 * Features:
 * - IndexedDB-backed persistent key storage
 * - Automatic key generation and management
 * - Session establishment with prekey bundles
 * - Message encryption/decryption
 * - Key backup/restore with client-side encryption
 * - Multi-tab/device synchronization
 *
 * Security Considerations:
 * - Private keys never leave IndexedDB unencrypted
 * - Backend storage uses client-side AES-256-GCM encryption
 * - User password required for key backup/restore (PBKDF2 with 100k iterations)
 * - Zero-knowledge architecture - server never sees plaintext keys
 * - All sensitive operations use proper type guards and validation
 *
 * Type Safety:
 * - Minimal use of type assertions, only for verified library interop
 * - Runtime validation with type guards for external data
 * - Comprehensive JSDoc documentation for all public functions
 *
 * @module crypto/signal
 */

import {
	SignalProtocolAddress,
	SessionBuilder,
	SessionCipher,
	EncryptionResultMessageType,
	KeyHelper,
	type Direction // Import Direction enum
} from '@privacyresearch/libsignal-protocol-typescript';
import type {
	DeviceType,
	KeyPairType,
	StorageType
} from '@privacyresearch/libsignal-protocol-typescript';
import type { 
	Identity, 
	PrekeyBundleData, 
	PrekeyBundlePayload,
	StoredSignedPreKey,
	SignalCache,
	EncryptedMessage,
	PublicPreKeyBundle,
	GeneratedIdentity,
	PublishPrekeyResponse
} from './types';
import { isStoredSignedPreKey } from './types';
import { logger } from '$lib/services/dev-logger';
import { encryptKeySet, decryptKeySet } from './keyEncryption';
import type { EncryptedKeyBundle, SignalKeySet } from '$lib/types';

// ============================================================================
// Constants
// ============================================================================

/** Default device ID used for Signal Protocol addressing */
const DEFAULT_DEVICE_ID = 1;

/** Default signed prekey ID */
const DEFAULT_SIGNED_PREKEY_ID = 1;

/** Number of one-time prekeys to generate */
const PREKEY_COUNT = 5;

/** Maximum prekey ID to scan when exporting keys */
const MAX_PREKEY_SCAN = 100;

// ============================================================================
// IndexedDB Signal Protocol Store Implementation
// ============================================================================

/**
 * IndexedDB-backed Signal Protocol storage implementation.
 *
 * This class implements the storage interface required by the Signal Protocol
 * library, providing persistent storage for:
 * - Identity key pairs
 * - Registration IDs
 * - Prekeys and signed prekeys
 * - Session state
 *
 * Note: This class is structurally compatible with StorageType but uses
 * StoredSignedPreKey for proper signature storage (library type definitions
 * don't perfectly match runtime requirements).
 */
class IndexedDBSignalProtocolStore {
	private dbName: string;
	private storeName = 'state';
	private db: IDBDatabase | null = null;
	// Use a type-safe cache to avoid 'as' assertions on every read
	private cache: SignalCache = {};

	constructor(userId: string) {
		// Make database name user-specific to avoid key collision between users
		this.dbName = `signal-protocol-store-${userId}`;
	}

	async init(): Promise<void> {
		if (this.db) return;

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, 1);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				this.db = request.result;
				this.loadCache().then(() => resolve());
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName);
				}
			};
		});
	}

	private async loadCache(): Promise<void> {
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction(this.storeName, 'readonly');
			const store = tx.objectStore(this.storeName);
			const request = store.openCursor();

			request.onerror = () => reject(request.error);
			request.onsuccess = (event: Event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
				if (cursor) {
					// Load into our type-safe cache
					this.cache[cursor.key as keyof SignalCache] = cursor.value;
					cursor.continue();
				} else {
					resolve();
				}
			};
		});
	}

	private async persist(key: keyof SignalCache, value: unknown): Promise<void> {
		if (!this.db) await this.init();

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction(this.storeName, 'readwrite');
			const store = tx.objectStore(this.storeName);
			const request = store.put(value, key);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	private async remove(key: keyof SignalCache): Promise<void> {
		if (!this.db) await this.init();

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction(this.storeName, 'readwrite');
			const store = tx.objectStore(this.storeName);
			const request = store.delete(key);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	// SignalProtocolStore interface implementation
	// StorageType methods (shape-compatible with library's expectations)
	async getIdentityKeyPair(): Promise<KeyPairType<ArrayBuffer> | undefined> {
		return this.cache['identityKeyPair'];
	}

	async getLocalRegistrationId(): Promise<number | undefined> {
		return this.cache['registrationId'];
	}

	// direction uses the Direction enum (1=SENDING, 2=RECEIVING)
	async isTrustedIdentity(
		identifier: string,
		identityKey: ArrayBuffer,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		direction?: Direction
	): Promise<boolean> {
		const key = `identity_${identifier}` as const;
		const existing = this.cache[key];
		if (!existing) return true;
		return this.arrayBufferEquals(existing, identityKey);
	}

	// Called by SessionBuilder to persist a remote identity key
	async saveIdentity(
		encodedAddress: string,
		publicKey: ArrayBuffer,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		nonblockingApproval?: boolean
	): Promise<boolean> {
		const key = `identity_${encodedAddress}` as const;
		const existing = this.cache[key];
		this.cache[key] = publicKey;
		await this.persist(key, publicKey);
		if (!existing) return false;
		return !this.arrayBufferEquals(existing, publicKey);
	}

	// PreKey handling
	async loadPreKey(encodedAddress: string | number): Promise<KeyPairType<ArrayBuffer> | undefined> {
		const id = typeof encodedAddress === 'number' ? encodedAddress : Number(encodedAddress);
		const key = `prekey_${id}` as const;
		return this.cache[key];
	}

	async storePreKey(keyId: number | string, keyPair: KeyPairType<ArrayBuffer>): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		const key = `prekey_${id}` as const;
		this.cache[key] = keyPair;
		await this.persist(key, keyPair);
	}

	/**
	 * Remove a prekey from storage
	 * @param keyId - Prekey ID to remove
	 */
	async removePreKey(keyId: number | string): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		const key = `prekey_${id}` as const;
		delete this.cache[key];
		await this.remove(key);
	}

	/**
	 * Load a signed prekey from storage
	 * Note: We store the full SignedPreKey with signature, not just the keypair
	 * @param keyId - Signed prekey ID
	 * @returns Stored signed prekey or undefined if not found
	 */
	async loadSignedPreKey(keyId: number | string): Promise<StoredSignedPreKey | undefined> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		const key = `signed_prekey_${id}` as const;
		const stored = this.cache[key];

		if (!stored) return undefined;

		// Validate the stored object has the right shape using type guard
		if (isStoredSignedPreKey(stored)) {
			return stored;
		}

		return undefined;
	}

	/**
	 * Store a signed prekey to storage
	 * Note: We store the full object with signature
	 * @param keyId - Signed prekey ID
	 * @param keyData - Complete signed prekey data with signature
	 */
	async storeSignedPreKey(keyId: number | string, keyData: StoredSignedPreKey): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		const key = `signed_prekey_${id}` as const;
		this.cache[key] = keyData;
		await this.persist(key, keyData);
	}

	/**
	 * Remove a signed prekey from storage
	 * @param keyId - Signed prekey ID to remove
	 */
	async removeSignedPreKey(keyId: number | string): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		const key = `signed_prekey_${id}` as const;
		delete this.cache[key];
		await this.remove(key);
	}

	// ========================================================================
	// Session Storage Methods
	// ========================================================================

	/**
	 * Load a session record by address
	 * Note: Library expects string-serialized session records
	 * @param encodedAddress - Encoded Signal Protocol address
	 * @returns Serialized session record or undefined
	 */
	async loadSession(encodedAddress: string): Promise<string | undefined> {
		const key = `session_${encodedAddress}` as const;
		return this.cache[key];
	}

	/**
	 * Store a session record
	 * @param encodedAddress - Encoded Signal Protocol address
	 * @param record - Serialized session record
	 */
	async storeSession(encodedAddress: string, record: string): Promise<void> {
		const key = `session_${encodedAddress}` as const;
		this.cache[key] = record;
		await this.persist(key, record);
	}

	/**
	 * Remove a single session
	 * @param encodedAddress - Encoded Signal Protocol address
	 */
	async removeSession(encodedAddress: string): Promise<void> {
		const key = `session_${encodedAddress}` as const;
		delete this.cache[key];
		await this.remove(key);
	}

	/**
	 * Remove all sessions for an address (all devices)
	 * @param encodedAddress - Base encoded address (without device ID)
	 */
	async removeAllSessions(encodedAddress: string): Promise<void> {
		const keys = Object.keys(this.cache).filter((k) =>
			k.startsWith(`session_${encodedAddress}`)
		) as (keyof SignalCache)[];

		for (const key of keys) {
			delete this.cache[key];
			await this.remove(key);
		}
	}

	// ========================================================================
	// Helper Methods for Key Storage
	// ========================================================================

	/**
	 * Store identity key pair for this device
	 * @param keyPair - Identity key pair to store
	 */
	async storeIdentityKeyPair(keyPair: KeyPairType<ArrayBuffer>): Promise<void> {
		this.cache['identityKeyPair'] = keyPair;
		await this.persist('identityKeyPair', keyPair);
	}

	/**
	 * Store local registration ID
	 * @param registrationId - Registration ID to store
	 */
	async storeLocalRegistrationId(registrationId: number): Promise<void> {
		this.cache['registrationId'] = registrationId;
		await this.persist('registrationId', registrationId);
	}

	/**
	 * Compare two ArrayBuffers for equality
	 * @private
	 * @param a - First ArrayBuffer
	 * @param b - Second ArrayBuffer
	 * @returns True if buffers contain identical byte sequences
	 */
	private arrayBufferEquals(a: ArrayBuffer, b: ArrayBuffer): boolean {
		const aView = new Uint8Array(a);
		const bView = new Uint8Array(b);
		if (aView.length !== bView.length) return false;
		for (let i = 0; i < aView.length; i++) {
			if (aView[i] !== bView[i]) return false;
		}
		return true;
	}

	/**
	 * Close the database connection and clear cache
	 * Should be called on logout to prevent memory leaks
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			this.cache = {};
		}
	}
}

// ============================================================================
// Global State Management
// ============================================================================

/** Global store instance */
let store: IndexedDBSignalProtocolStore | null = null;

/** Track if the store is initialized */
let initialized = false;

/** Current user ID for the store */
let currentUserId: string | null = null;

/** Ongoing initialization promise to prevent concurrent initializations */
let initializationPromise: Promise<void> | null = null;

/** Ongoing restore promise to prevent concurrent restore operations */
let restorePromise: Promise<boolean> | null = null;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert ArrayBuffer to Base64 string
 * Used for encoding binary keys for network transmission
 * @param buffer - ArrayBuffer to convert
 * @returns Base64 encoded string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * Convert Base64 string to ArrayBuffer
 * Used for decoding keys received from network
 * @param base64 - Base64 encoded string
 * @returns Decoded ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

// ============================================================================
// Core Signal Protocol Functions
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
		// After waiting, check if we need a different userId
		if (userId && userId !== currentUserId) {
			// Need to re-initialize with different user, continue below
		} else {
			return; // Same user or no user specified, we're done
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
			await store!.init();
			initialized = true;
			logger.info('[Signal] Initialization complete for userId:', currentUserId);
		} finally {
			initializationPromise = null;
		}
	})();

	await initializationPromise;
}

/**
 * Get the current store instance (throws if not initialized)
 */
function getStore(): IndexedDBSignalProtocolStore {
	if (!store) {
		throw new Error('Signal store not initialized. Call initSignal(userId) first.');
	}
	return store;
}

/**
 * Check if this device has encryption keys stored locally in IndexedDB
 * Returns true if identity keypair and signed prekey exist
 */
export async function hasLocalKeys(userId?: string): Promise<boolean> {
	await initSignal(userId);
	const identityKeyPair = await getStore().getIdentityKeyPair();
	const signedPreKey = await getStore().loadSignedPreKey(1); // We always use keyId 1 for signed prekey
	return !!(identityKeyPair && signedPreKey);
}

/**
 * Check if we have an established session with a user
 */
export async function hasSession(targetUserId: string, currentUserId?: string): Promise<boolean> {
	await initSignal(currentUserId);
	const address = new SignalProtocolAddress(targetUserId, 1);
	const session = await getStore().loadSession(address.toString());
	return !!session;
}

/**
 * Generate a complete Signal Protocol identity with all necessary keys
 *
 * All keys are stored in IndexedDB automatically.
 *
 * @returns Identity object with public/private keys and prekey bundle
 * @throws Error if store is not initialized
 */
export async function generateSignalIdentity(): Promise<GeneratedIdentity> {
	const storeInstance = getStore();

	// Use KeyHelper from the library to generate keys
	const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
	const registrationId = KeyHelper.generateRegistrationId();

	// Generate one-time prekeys for forward secrecy
	const preKeys: Array<{ keyId: number; keyPair: KeyPairType<ArrayBuffer> }> = [];
	for (let i = 1; i <= PREKEY_COUNT; i++) {
		const pk = await KeyHelper.generatePreKey(i);
		preKeys.push(pk);
	}

	// Generate signed prekey (proves identity key ownership)
	const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, DEFAULT_SIGNED_PREKEY_ID);

	// Store locally in IndexedDB
	await storeInstance.storeIdentityKeyPair(identityKeyPair);
	await storeInstance.storeLocalRegistrationId(registrationId);

	// Store signed prekey with proper type structure
	const signedPreKeyData: StoredSignedPreKey = {
		pubKey: signedPreKey.keyPair.pubKey,
		privKey: signedPreKey.keyPair.privKey,
		signature: signedPreKey.signature
	};
	await storeInstance.storeSignedPreKey(signedPreKey.keyId, signedPreKeyData);

	// Store all one-time prekeys
	for (const preKey of preKeys) {
		await storeInstance.storePreKey(preKey.keyId, preKey.keyPair);
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
 * @throws Error if publish fails
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
 * Generate and publish a complete Signal Protocol identity
 *
 * @param apiBase - API base URL
 * @param userId - User ID
 * @param deviceId - Device ID
 * @returns Server response from publish operation
 * @throws Error if generation or publish fails
 */
export async function generateAndPublishIdentity(
	apiBase: string,
	userId: string,
	deviceId: string
): Promise<PublishPrekeyResponse> {
	// Ensure store is initialized for this user before generating identity
	await initSignal(userId);
	const identity = await generateSignalIdentity();
	const bundle = identity._signalBundle;
	if (!bundle) {
		throw new Error('No generated prekey bundle available');
	}
	return publishSignalPrekey(apiBase, userId, deviceId, bundle);
}

/**
 * Create a Signal Protocol session with a remote user's prekey bundle
 *
 * @param prekeyBundle - Remote user's prekey bundle from server
 * @param currentUserId - Optional current user ID for store initialization
 * @throws Error if bundle is invalid or session creation fails
 */
export async function createSessionWithPrekeyBundle(
	prekeyBundle: unknown,
	currentUserId?: string
): Promise<void> {
	await initSignal(currentUserId);

	// Narrow unknown payload to expected shape with runtime validation
	const payload = prekeyBundle as PrekeyBundlePayload;
	const bundleData: PrekeyBundleData =
		payload?.bundle ?? (prekeyBundle as PrekeyBundleData);
	const userId = payload?.userId ?? bundleData.userId ?? 'unknown';

	logger.info('[Signal] Creating session with prekey bundle:', {
		userId,
		hasIdentityKey: !!bundleData.identityKey,
		hasSignedPreKey: !!bundleData.signedPreKey,
		hasPreKeys: Array.isArray(bundleData.preKeys) && bundleData.preKeys.length > 0,
		registrationId: bundleData.registrationId
	});

	// Validate required fields
	if (typeof bundleData.identityKey !== 'string' || typeof bundleData.registrationId !== 'number') {
		throw new Error('Invalid prekey bundle: missing required fields');
	}

	if (!bundleData.signedPreKey) {
		throw new Error('Invalid prekey bundle: signed prekey is required');
	}

	const signedPreKey = bundleData.signedPreKey;
	if (
		typeof signedPreKey.id !== 'number' ||
		typeof signedPreKey.publicKey !== 'string' ||
		typeof signedPreKey.signature !== 'string'
	) {
		throw new Error('Invalid prekey bundle: malformed signed prekey');
	}

	// Build a DeviceType object expected by SessionBuilder.processPreKey
	const device: DeviceType = {
		identityKey: base64ToArrayBuffer(bundleData.identityKey),
		registrationId: bundleData.registrationId,
		signedPreKey: {
			keyId: signedPreKey.id,
			publicKey: base64ToArrayBuffer(signedPreKey.publicKey),
			signature: base64ToArrayBuffer(signedPreKey.signature)
		}
	};

	// Add one-time prekey if available (optional, provides forward secrecy)
	if (Array.isArray(bundleData.preKeys) && bundleData.preKeys.length > 0) {
		const preKey = bundleData.preKeys[0];
		if (typeof preKey.id === 'number' && typeof preKey.publicKey === 'string') {
			device.preKey = {
				keyId: preKey.id,
				publicKey: base64ToArrayBuffer(preKey.publicKey)
			};
		}
	}

	const address = new SignalProtocolAddress(userId, DEFAULT_DEVICE_ID);

	// NOTE: 'as unknown as StorageType' is required here.
	// Our store implementation is structurally compatible, but our
	// 'loadSignedPreKey' returns a 'StoredSignedPreKey' (with signature),
	// which differs from the 'StorageType' interface (which expects KeyPairType).
	// The library's runtime *requires* this signature, so this assertion
	// bridges the gap between the library's types and its runtime behavior.
	const sessionBuilder = new SessionBuilder(getStore() as unknown as StorageType, address);

	logger.info('[Signal] Processing prekey to establish session...');
	try {
		await sessionBuilder.processPreKey(device);
		logger.info('[Signal] Session established successfully with:', userId);
	} catch (error) {
		logger.error('[Signal] Failed to establish session:', error);
		throw error;
	}
}

/**
 * Encrypt a plaintext message for a recipient using Signal Protocol
 *
 * @param recipientId - User ID of the recipient
 * @param plaintext - Plaintext message to encrypt
 * @param currentUserId - Optional current user ID for store initialization
 * @returns Encrypted message with type and base64-encoded body
 * @throws Error if no session exists or encryption fails
 */
export async function encryptMessage(
	recipientId: string,
	plaintext: string,
	currentUserId?: string
): Promise<EncryptedMessage> {
	await initSignal(currentUserId);

	const address = new SignalProtocolAddress(recipientId, DEFAULT_DEVICE_ID);
	// NOTE: 'as unknown as StorageType' is required for the same reason
	// as 'createSessionWithPrekeyBundle'. The SessionCipher relies on
	// the store, which has a mismatched (but required) type definition.
	const sessionCipher = new SessionCipher(getStore() as unknown as StorageType, address);

	const encoder = new TextEncoder();
	const messageBytes = encoder.encode(plaintext);

	const ciphertext = await sessionCipher.encrypt(messageBytes.buffer);

	logger.info('[Signal] Encryption result:', {
		type: ciphertext.type,
		bodyType: typeof ciphertext.body,
		bodyPresent: !!ciphertext.body
	});

	// Validate encryption result
	if (!ciphertext.body) {
		throw new Error('Signal encryption produced no ciphertext body');
	}

	// Convert body to base64 string for transmission
	let bodyBase64: string;
	const body: unknown = ciphertext.body;

	if (typeof body === 'string') {
		// Check if it's already base64 or binary string
		const isBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(body);

		if (isBase64 && body.length % 4 === 0) {
			logger.info('[Signal] Body is already base64');
			bodyBase64 = body;
		} else {
			logger.info('[Signal] Body is binary string, converting to base64');
			bodyBase64 = btoa(body);
		}
	} else if (body instanceof ArrayBuffer) {
		logger.info('[Signal] Body is ArrayBuffer, converting to base64');
		bodyBase64 = arrayBufferToBase64(body);
	} else {
		logger.error('[Signal] Unexpected body type:', typeof body);
		throw new Error('Unexpected ciphertext body type');
	}

	logger.debug('[Signal] Encrypted message', {
		length: bodyBase64.length,
		preview: bodyBase64.substring(0, 50)
	});

	return {
		type: ciphertext.type as EncryptionResultMessageType,
		body: bodyBase64
	};
}

/**
 * Decrypt a ciphertext message from a sender using Signal Protocol
 *
 * @param senderId - User ID of the sender
 * @param ciphertext - Encrypted message (object or string)
 * @param currentUserId - Optional current user ID for store initialization
 * @returns Decrypted plaintext message
 * @throws Error if decryption fails or session is invalid
 */
export async function decryptMessage(
	senderId: string,
	ciphertext: EncryptedMessage | string,
	currentUserId?: string
): Promise<string> {
	await initSignal(currentUserId);

	// Determine message type and decode body from base64
	let ctType: EncryptionResultMessageType;
	let ctBody: ArrayBuffer;

	if (typeof ciphertext === 'string') {
		// Legacy format: string is assumed to be PreKeyWhisperMessage
		ctType = EncryptionResultMessageType.PreKeyWhisperMessage;
		ctBody = base64ToArrayBuffer(ciphertext);
	} else {
		// Standard format: object with type and body
		ctType = ciphertext.type as EncryptionResultMessageType;
		ctBody = base64ToArrayBuffer(ciphertext.body);
	}

	logger.info('[Signal] Decrypting message:', {
		senderId,
		messageType: ctType,
		messageTypeName: ctType === 3 ? 'PreKeyWhisperMessage' : 'WhisperMessage',
		bodyLength: ctBody.byteLength,
		currentUserId
	});

	const address = new SignalProtocolAddress(senderId, DEFAULT_DEVICE_ID);
	// NOTE: 'as unknown as StorageType' is required for the same reason
	// as 'createSessionWithPrekeyBundle'.
	const sessionCipher = new SessionCipher(getStore() as unknown as StorageType, address);

	let plaintext: ArrayBuffer;

	try {
		// Type 3 (PreKeyWhisperMessage) establishes or uses session with prekey
		// Type 1 (WhisperMessage) uses existing session
		if (ctType === EncryptionResultMessageType.PreKeyWhisperMessage) {
			logger.info('[Signal] Decrypting PreKeyWhisperMessage - will establish/use session');
			plaintext = await sessionCipher.decryptPreKeyWhisperMessage(ctBody, 'binary');
		} else {
			logger.info('[Signal] Decrypting WhisperMessage - using existing session');
			plaintext = await sessionCipher.decryptWhisperMessage(ctBody, 'binary');
		}
		logger.info('[Signal] Decryption successful, plaintext length:', plaintext.byteLength);
	} catch (error) {
		logger.error('[Signal] Decryption error details:', {
			error,
			senderId,
			messageType: ctType,
			hasSession: !!(await getStore().loadSession(address.toString()))
		});
		throw error;
	}

	// Decode UTF-8 plaintext
	const decoder = new TextDecoder();
	return decoder.decode(plaintext);
}

/**
 * Clear all Signal Protocol state for a user
 *
 * ⚠️ WARNING: This is destructive and cannot be undone!
 *
 * @param userId - User ID to clear state for
 * @throws Error if deletion fails (but handles blocked state gracefully)
 */
export async function clearSignalState(userId: string): Promise<void> {
	const dbName = `signal-protocol-store-${userId}`;

	// Close the database connection first to prevent blocking
	if (store && currentUserId === userId) {
		store.close();
		store = null;
		initialized = false;
		currentUserId = null;
	}

	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(dbName);

		request.onerror = () => reject(request.error);

		request.onsuccess = () => {
			logger.info(`[Signal] Deleted database ${dbName}`);
			resolve();
		};

		request.onblocked = () => {
			logger.warning(`[Signal] Database ${dbName} deletion blocked - this can happen if other tabs are open`);
			// Resolve anyway - the database will be deleted once other connections close
			resolve();
		};
	});
}

/**
 * Export complete Signal key set for backup to backend
 *
 * ⚠️ SECURITY WARNING: This function returns PLAINTEXT keys!
 * Always wrap with encryptKeySet() before sending to backend.
 *
 * @param userId - User ID to export keys for
 * @returns Complete key set in plaintext
 * @throws Error if required keys are missing
 */
export async function exportSignalKeys(userId: string): Promise<SignalKeySet> {
	await initSignal(userId);
	const s = getStore();

	// Get identity key pair (required)
	const identityKeyPair = await s.getIdentityKeyPair();
	if (!identityKeyPair) {
		throw new Error('No identity key pair found');
	}

	// Get registration ID (required)
	const registrationId = await s.getLocalRegistrationId();
	if (registrationId === undefined) {
		throw new Error('No registration ID found');
	}

	// Get signed prekey (required, always stored with keyId 1)
	const signedPreKey = await s.loadSignedPreKey(DEFAULT_SIGNED_PREKEY_ID);
	if (!signedPreKey || !isStoredSignedPreKey(signedPreKey)) {
		throw new Error('No signed prekey found or invalid format');
	}

	// Get all one-time prekeys (scan up to MAX_PREKEY_SCAN)
	const preKeys: SignalKeySet['preKeys'] = [];
	for (let i = 1; i <= MAX_PREKEY_SCAN; i++) {
		const preKey = await s.loadPreKey(i);
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
 * @param userId - User ID to import keys for
 * @param keySet - Complete key set (decrypted)
 * @throws Error if key format is invalid
 */
export async function importSignalKeys(userId: string, keySet: SignalKeySet): Promise<void> {
	await initSignal(userId);
	const s = getStore();

	// Validate key set structure
	if (!keySet.identityKeyPair || !keySet.signedPreKeyPair || !Array.isArray(keySet.preKeys)) {
		throw new Error('Invalid key set structure');
	}

	// Store identity key pair
	await s.storeIdentityKeyPair({
		pubKey: base64ToArrayBuffer(keySet.identityKeyPair.pubKey),
		privKey: base64ToArrayBuffer(keySet.identityKeyPair.privKey)
	});

	// Store registration ID
	await s.storeLocalRegistrationId(keySet.registrationId);

	// Store signed prekey with proper type structure
	const signedPreKeyData: StoredSignedPreKey = {
		pubKey: base64ToArrayBuffer(keySet.signedPreKeyPair.keyPair.pubKey),
		privKey: base64ToArrayBuffer(keySet.signedPreKeyPair.keyPair.privKey),
		signature: base64ToArrayBuffer(keySet.signedPreKeyPair.signature)
	};
	await s.storeSignedPreKey(keySet.signedPreKeyPair.keyId, signedPreKeyData);

	// Store all one-time prekeys
	for (const preKey of keySet.preKeys) {
		await s.storePreKey(preKey.keyId, {
			pubKey: base64ToArrayBuffer(preKey.keyPair.pubKey),
			privKey: base64ToArrayBuffer(preKey.keyPair.privKey)
		});
	}

	logger.info('[Signal] Successfully imported keys from backend', {
		preKeyCount: keySet.preKeys.length,
		userId
	});
}

/**
 * Export and encrypt Signal keys for secure backend storage
 *
 * @param userId - User ID
 * @param deviceId - Device ID for key isolation
 * @param password - Encryption password
 * @returns Encrypted key bundle safe for backend storage
 */
export async function exportAndEncryptSignalKeys(
	userId: string,
	deviceId: string,
	password: string
): Promise<EncryptedKeyBundle> {
	logger.info('[Signal] Exporting and encrypting keys for device:', deviceId);

	// Export plaintext keys
	const plaintextKeys = await exportSignalKeys(userId);

	// Encrypt with user password
	const encryptedBundle = await encryptKeySet(plaintextKeys, password, deviceId);

	logger.info('[Signal] Keys encrypted and ready for backend storage');
	return encryptedBundle;
}

/**
 * Decrypt and import Signal keys from backend
 *
 * @param userId - User ID
 * @param encryptedBundle - Encrypted bundle from backend
 * @param password - Decryption password
 */
export async function decryptAndImportSignalKeys(
	userId: string,
	encryptedBundle: EncryptedKeyBundle,
	password: string
): Promise<void> {
	logger.info('[Signal] Decrypting and importing keys for device:', encryptedBundle.deviceId);

	// Decrypt with user password
	const plaintextKeys = await decryptKeySet(encryptedBundle, password);

	// Import to IndexedDB
	await importSignalKeys(userId, plaintextKeys);

	logger.info('[Signal] Keys decrypted and imported successfully');
}

/**
 * Initialize Signal Protocol with key restoration from backend if available
 *
 * @param userId - User ID
 * @param deviceId - Device ID
 * @param apiBase - API base URL
 * @param encryptionPassword - Optional password for key encryption (if null, skip backup)
 */
export async function initSignalWithRestore(
	userId: string,
	deviceId: string,
	apiBase: string,
	encryptionPassword?: string
): Promise<boolean> {
	// If there's an ongoing restore, wait for it to complete
	if (restorePromise) {
		logger.info('[Signal] Waiting for ongoing restore to complete...');
		return await restorePromise;
	}

	logger.info('[Signal] Initializing with restore for userId:', userId);

	// Create restore promise to prevent concurrent restore operations
	restorePromise = (async () => {
		try {
			await initSignal(userId);

			// ALWAYS check backend first to ensure consistency across tabs/devices
			logger.info('[Signal] Checking backend for authoritative encrypted keys...');
			try {
				const { authService } = await import('$lib/services/auth.service');
				const encryptedBundle = await authService.fetchSignalKeys(deviceId);

				if (encryptedBundle && encryptionPassword) {
					logger.info('[Signal] Found encrypted keys on backend, decrypting and restoring...');

					// Clear local IndexedDB to ensure we start fresh with backend keys
					await clearSignalState(userId);

					// Re-initialize store with empty state
					store = new IndexedDBSignalProtocolStore(userId);
					currentUserId = userId;
					initialized = false;
					initializationPromise = null; // Reset initialization promise
					await initSignal(userId);

					// Decrypt and import backend keys (CLIENT-SIDE DECRYPTION)
					await decryptAndImportSignalKeys(userId, encryptedBundle, encryptionPassword);
					logger.info('[Signal] Successfully decrypted and restored keys from backend');

					// Re-initialize the store to load the imported keys into memory cache
					store = null;
					initialized = false;
					initializationPromise = null; // Reset initialization promise
					await initSignal(userId);
					logger.info('[Signal] Store reinitialized with restored keys');

					return true;
				}

				// No keys on backend - check if we have local keys as fallback
				logger.info('[Signal] No keys on backend, checking local storage...');
				const hasKeys = await hasLocalKeys(userId);

				if (hasKeys && encryptionPassword) {
					logger.info('[Signal] Found local keys, encrypting and backing them up to backend...');
					// We have local keys but backend doesn't - back them up (ENCRYPTED)
					const encryptedBundle = await exportAndEncryptSignalKeys(userId, deviceId, encryptionPassword);
					await authService.storeSignalKeys(deviceId, encryptedBundle);
					logger.info('[Signal] Successfully backed up encrypted keys to backend');
					return true;
				}

				// No keys anywhere, generate new keys
				logger.info('[Signal] No keys found anywhere, generating new keys...');
				await generateAndPublishIdentity(apiBase, userId, deviceId);

				// Export and store the newly generated keys on backend (ENCRYPTED)
				if (encryptionPassword) {
					logger.info('[Signal] Encrypting and backing up newly generated keys to backend...');
					const encryptedBundle = await exportAndEncryptSignalKeys(userId, deviceId, encryptionPassword);
					await authService.storeSignalKeys(deviceId, encryptedBundle);
					logger.info('[Signal] Successfully backed up encrypted keys to backend');
				} else {
					logger.warning('[Signal] No encryption password provided - keys will NOT be backed up to backend');
				}

				return true;
			} catch (error) {
				logger.error('[Signal] Error during key initialization/restore:', error);

				// Fallback: check if we have local keys we can use
				const hasKeys = await hasLocalKeys(userId);
				if (hasKeys) {
					logger.warning('[Signal] Backend fetch failed, using local keys as fallback');
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

/**
 * Remove all sessions with a specific user
 *
 * @param targetUserId - User ID to remove sessions with
 * @param currentUserId - Current user ID for store initialization
 */
export async function removeSessionWith(
	targetUserId: string,
	currentUserId: string
): Promise<void> {
	await initSignal(currentUserId);
	if (!store) {
		logger.warning('[Signal] No store found for user');
		return;
	}

	await store.removeAllSessions(targetUserId);
	logger.info(`[Signal] Removed all sessions with user ${targetUserId}`);
}

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