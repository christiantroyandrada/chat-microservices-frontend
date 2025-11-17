/* eslint-disable */
/*
 * Signal Protocol implementation using @privacyresearch/libsignal-protocol-typescript
 * Browser-compatible E2EE using pure TypeScript implementation
 *
 * Note on 'as any' casts:
 * This file contains minimal, justified 'as any' casts for library interop where:
 * 1. The libsignal library's TypeScript definitions don't perfectly match runtime shapes
 * 2. SessionBuilder/SessionCipher require StorageType but our adapter has slight mismatches
 * These casts are localized and documented inline to maintain type safety elsewhere.
 */

import {
	SignalProtocolAddress,
	SessionBuilder,
	SessionCipher,
	EncryptionResultMessageType,
	KeyHelper
} from '@privacyresearch/libsignal-protocol-typescript';
import type {
	PreKeyType,
	SignedPublicPreKeyType,
	DeviceType,
	KeyPairType
} from '@privacyresearch/libsignal-protocol-typescript';
import type { Identity, PrekeyBundleData, PrekeyBundlePayload } from './types';
import { logger } from '$lib/services/dev-logger';

// IndexedDB-backed store implementation
// Implement the StorageType-compatible store expected by the library.
// We purposefully avoid a direct interface implementation here to keep
// the runtime shape correct while being resilient to minor type mismatches.
class IndexedDBSignalProtocolStore {
	private dbName: string;
	private storeName = 'state';
	private db: IDBDatabase | null = null;
	private cache: Record<string, unknown> = {};

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
				const cursor = (event.target as IDBRequest).result;
				if (cursor) {
					this.cache[cursor.key] = cursor.value;
					cursor.continue();
				} else {
					resolve();
				}
			};
		});
	}

	private async persist(key: string, value: unknown): Promise<void> {
		if (!this.db) await this.init();

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction(this.storeName, 'readwrite');
			const store = tx.objectStore(this.storeName);
			const request = store.put(value, key);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	private async remove(key: string): Promise<void> {
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
		return (this.cache['identityKeyPair'] as KeyPairType<ArrayBuffer> | undefined) || undefined;
	}

	async getLocalRegistrationId(): Promise<number | undefined> {
		return (this.cache['registrationId'] as number) ?? undefined;
	}

	// direction is the enum Direction (1=SENDING,2=RECEIVING) but we accept number to be flexible
	async isTrustedIdentity(
		identifier: string,
		identityKey: ArrayBuffer,
		direction?: number
	): Promise<boolean> {
		const key = `identity_${identifier}`;
		const existing: ArrayBuffer | undefined = this.cache[key] as ArrayBuffer | undefined;
		if (!existing) return true;
		return this.arrayBufferEquals(existing, identityKey);
	}

	// Called by SessionBuilder to persist a remote identity key
	async saveIdentity(
		encodedAddress: string,
		publicKey: ArrayBuffer,
		nonblockingApproval?: boolean
	): Promise<boolean> {
		const key = `identity_${encodedAddress}`;
		const existing: ArrayBuffer | undefined = this.cache[key] as ArrayBuffer | undefined;
		this.cache[key] = publicKey;
		await this.persist(key, publicKey);
		if (!existing) return false;
		return !this.arrayBufferEquals(existing, publicKey);
	}

	// PreKey handling
	async loadPreKey(encodedAddress: string | number): Promise<KeyPairType<ArrayBuffer> | undefined> {
		const id = typeof encodedAddress === 'number' ? encodedAddress : Number(encodedAddress);
		return this.cache[`prekey_${id}`] as KeyPairType<ArrayBuffer> | undefined;
	}

	async storePreKey(keyId: number | string, keyPair: KeyPairType<ArrayBuffer>): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		this.cache[`prekey_${id}`] = keyPair;
		await this.persist(`prekey_${id}`, keyPair);
	}

	async removePreKey(keyId: number | string): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		delete this.cache[`prekey_${id}`];
		await this.remove(`prekey_${id}`);
	}

	async loadSignedPreKey(keyId: number | string): Promise<SignedPublicPreKeyType | undefined> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		return this.cache[`signed_prekey_${id}`] as SignedPublicPreKeyType | undefined;
	}

	async storeSignedPreKey(keyId: number | string, keyPair: SignedPublicPreKeyType): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		this.cache[`signed_prekey_${id}`] = keyPair;
		await this.persist(`signed_prekey_${id}`, keyPair);
	}

	async removeSignedPreKey(keyId: number | string): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		delete this.cache[`signed_prekey_${id}`];
		await this.remove(`signed_prekey_${id}`);
	}

	// Session storage: library expects string serialized records
	async loadSession(encodedAddress: string): Promise<string | undefined> {
		return this.cache[`session_${encodedAddress}`] as string | undefined;
	}

	async storeSession(encodedAddress: string, record: string): Promise<void> {
		this.cache[`session_${encodedAddress}`] = record;
		await this.persist(`session_${encodedAddress}`, record);
	}

	async removeSession(encodedAddress: string): Promise<void> {
		delete this.cache[`session_${encodedAddress}`];
		await this.remove(`session_${encodedAddress}`);
	}

	async removeAllSessions(encodedAddress: string): Promise<void> {
		const keys = Object.keys(this.cache).filter((k) => k.startsWith(`session_${encodedAddress}`));
		for (const key of keys) {
			delete this.cache[key];
			await this.remove(key);
		}
	}

	// Helper methods
	async storeIdentityKeyPair(keyPair: KeyPairType<ArrayBuffer>): Promise<void> {
		this.cache['identityKeyPair'] = keyPair;
		await this.persist('identityKeyPair', keyPair);
	}

	async storeLocalRegistrationId(registrationId: number): Promise<void> {
		this.cache['registrationId'] = registrationId;
		await this.persist('registrationId', registrationId);
	}

	private arrayBufferEquals(a: ArrayBuffer, b: ArrayBuffer): boolean {
		const aView = new Uint8Array(a);
		const bView = new Uint8Array(b);
		if (aView.length !== bView.length) return false;
		for (let i = 0; i < aView.length; i++) {
			if (aView[i] !== bView[i]) return false;
		}
		return true;
	}

	// Close the database connection
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			this.cache = {};
		}
	}
}

let store: IndexedDBSignalProtocolStore | null = null;
let initialized = false;
let currentUserId: string | null = null;
let initializationPromise: Promise<void> | null = null;
let restorePromise: Promise<boolean> | null = null;

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

export async function generateSignalIdentity(): Promise<Identity & { _signalBundle?: unknown }> {
	const storeInstance = getStore();

	// Use KeyHelper from the library to generate keys
	const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
	const registrationId = KeyHelper.generateRegistrationId();

	// Generate one-time prekeys
	const preKeys: Array<{ keyId: number; keyPair: KeyPairType<ArrayBuffer> }> = [];
	for (let i = 1; i <= 5; i++) {
		const pk = await KeyHelper.generatePreKey(i);
		preKeys.push(pk);
	}

	const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);

	// Store locally
	await storeInstance.storeIdentityKeyPair(identityKeyPair);
	await storeInstance.storeLocalRegistrationId(registrationId);
	// cast to any for library interop - runtime shape is provided by lib
	await storeInstance.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair as any);

	for (const preKey of preKeys) {
		await storeInstance.storePreKey(preKey.keyId, preKey.keyPair as KeyPairType<ArrayBuffer>);
	}

	// Convert to base64 for transmission
	const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	};

	const identity: Identity = {
		publicKey: arrayBufferToBase64(identityKeyPair.pubKey),
		privateKey: arrayBufferToBase64(identityKeyPair.privKey)
	};

	const bundle = {
		identityKey: arrayBufferToBase64(identityKeyPair.pubKey),
		registrationId,
		signedPreKey: {
			id: signedPreKey.keyId,
			// signedPreKey.keyPair has a runtime shape provided by the lib; we treat it as unknown and cast where needed
			publicKey: arrayBufferToBase64(
				(signedPreKey.keyPair as unknown as { pubKey: ArrayBuffer }).pubKey
			),
			signature: arrayBufferToBase64(signedPreKey.signature)
		},
		preKeys: preKeys.map((pk) => ({
			id: pk.keyId,
			publicKey: arrayBufferToBase64((pk.keyPair as unknown as { pubKey: ArrayBuffer }).pubKey)
		}))
	};

	return Object.assign(identity, { _signalBundle: bundle });
}

export async function publishSignalPrekey(
	apiBase: string,
	userId: string,
	deviceId: string,
	bundle: unknown
): Promise<unknown> {
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

	return response.json();
}

export async function generateAndPublishIdentity(
	apiBase: string,
	userId: string,
	deviceId: string
): Promise<unknown> {
	// Ensure store is initialized for this user before generating identity
	await initSignal(userId);
	const identity = await generateSignalIdentity();
	const bundle = (identity as unknown as { _signalBundle?: unknown })._signalBundle;
	if (!bundle) throw new Error('No generated prekey bundle available');
	return publishSignalPrekey(apiBase, userId, deviceId, bundle);
}

export async function createSessionWithPrekeyBundle(
	prekeyBundle: unknown,
	currentUserId?: string
): Promise<void> {
	await initSignal(currentUserId);

	// Narrow unknown payload to expected shape
	const payload = prekeyBundle as PrekeyBundlePayload;
	const bundleData: PrekeyBundleData =
		(payload?.bundle as PrekeyBundleData) || (prekeyBundle as PrekeyBundleData);
	const userId = payload?.userId || bundleData.userId || 'unknown';

	logger.info('[Signal] Creating session with prekey bundle:', {
		userId,
		hasIdentityKey: !!bundleData.identityKey,
		hasSignedPreKey: !!bundleData.signedPreKey,
		hasPreKeys: !!(bundleData.preKeys && bundleData.preKeys.length > 0),
		registrationId: bundleData.registrationId
	});

	const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes.buffer;
	};

	// Build a DeviceType object expected by SessionBuilder.processPreKey
	const device: DeviceType = {
		identityKey: base64ToArrayBuffer(bundleData.identityKey as string),
		registrationId: bundleData.registrationId as number
	} as DeviceType;

	if (bundleData.signedPreKey) {
		device.signedPreKey = {
			keyId: bundleData.signedPreKey.id as number,
			publicKey: base64ToArrayBuffer(bundleData.signedPreKey.publicKey as string),
			signature: base64ToArrayBuffer(bundleData.signedPreKey.signature as string)
		} as SignedPublicPreKeyType;
	}

	if (bundleData.preKeys && bundleData.preKeys.length > 0) {
		device.preKey = {
			keyId: bundleData.preKeys[0].id as number,
			publicKey: base64ToArrayBuffer(bundleData.preKeys[0].publicKey as string)
		} as PreKeyType;
	}

	const address = new SignalProtocolAddress(userId, 1);
	const sessionBuilder = new SessionBuilder(getStore() as any, address);
	
	logger.info('[Signal] Processing prekey to establish session...');
	try {
		await sessionBuilder.processPreKey(device);
		logger.info('[Signal] Session established successfully with:', userId);
	} catch (error) {
		logger.error('[Signal] Failed to establish session:', error);
		throw error;
	}
}

export async function encryptMessage(
	recipientId: string,
	plaintext: string,
	currentUserId?: string
): Promise<{ type: number; body: string }> {
	await initSignal(currentUserId);

	const address = new SignalProtocolAddress(recipientId, 1);
	const sessionCipher = new SessionCipher(getStore() as any, address);

	const encoder = new TextEncoder();
	const messageBytes = encoder.encode(plaintext);

	const ciphertext = await sessionCipher.encrypt(messageBytes.buffer);

	logger.info('[Signal] Encryption result:', {
		type: ciphertext.type,
		bodyType: typeof ciphertext.body,
		bodyIsString: typeof ciphertext.body === 'string',
		bodyIsArrayBuffer: (ciphertext.body as any) instanceof ArrayBuffer,
		bodyLength: (ciphertext.body as any)?.length
	});

	// SessionCipher.encrypt returns MessageType with body as optional string (base64 encoded)
	// The library already returns body as base64 string, not ArrayBuffer
	if (!ciphertext.body) {
		throw new Error('Signal encryption produced no ciphertext body');
	}

	// The library returns body as a binary string (raw bytes), we need to convert to base64
	let bodyBase64: string;
	const body: unknown = ciphertext.body;

	if (body instanceof ArrayBuffer) {
		logger.info('[Signal] Body is ArrayBuffer, converting to base64');
		const bytes = new Uint8Array(body);
		bodyBase64 = btoa(String.fromCharCode(...bytes));
	} else if (typeof body === 'string') {
		// Check if it's already base64 or binary string
		// Binary strings will have characters outside the base64 character set
		const isBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(body);

		if (isBase64 && body.length % 4 === 0) {
			logger.info('[Signal] Body is already base64');
			bodyBase64 = body;
		} else {
			logger.info('[Signal] Body is binary string, converting to base64');
			// Binary string - convert to base64
			bodyBase64 = btoa(body);
		}
	} else {
		logger.error('[Signal] Unexpected body type:', body);
		throw new Error('Unexpected ciphertext body type');
	}

	logger.debug('[Signal] Final base64', {
		length: String(bodyBase64.length),
		preview: bodyBase64.substring(0, 50)
	});

	return {
		type: ciphertext.type,
		body: bodyBase64
	};
}

export async function decryptMessage(
	senderId: string,
	ciphertext: { type: number; body: string } | string,
	currentUserId?: string
): Promise<string> {
	await initSignal(currentUserId);

	const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes.buffer;
	};

	let ctType: EncryptionResultMessageType;
	let ctBody: ArrayBuffer;

	if (typeof ciphertext === 'string') {
		ctType = EncryptionResultMessageType.PreKeyWhisperMessage;
		ctBody = base64ToArrayBuffer(ciphertext);
	} else {
		ctType = ciphertext.type as EncryptionResultMessageType;
		ctBody = base64ToArrayBuffer(ciphertext.body);
	}

	logger.info('[Signal] Decrypting message:', {
		senderId,
		messageType: ctType,
		bodyLength: ctBody.byteLength,
		currentUserId
	});

	const address = new SignalProtocolAddress(senderId, 1);
	const sessionCipher = new SessionCipher(getStore() as any, address);

	let plaintext: ArrayBuffer;

	try {
		if (ctType === 3) {
			logger.info('[Signal] Decrypting PreKeyWhisperMessage (type 3) - this will establish/use a session');
			plaintext = await sessionCipher.decryptPreKeyWhisperMessage(ctBody, 'binary');
		} else {
			logger.info('[Signal] Decrypting WhisperMessage (type 1) - using existing session');
			plaintext = await sessionCipher.decryptWhisperMessage(ctBody, 'binary');
		}
		logger.info('[Signal] Decryption successful, plaintext length:', plaintext.byteLength);
	} catch (error) {
		logger.error('[Signal] Decryption error details:', {
			error,
			senderId,
			messageType: ctType,
			hasSession: await getStore().loadSession(address.toString())
		});
		throw error;
	}

	const decoder = new TextDecoder();
	return decoder.decode(plaintext);
}

/**
 * Clear all Signal Protocol state for a user
 * Useful for debugging encryption issues or resetting sessions
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
			// This prevents the Promise from hanging indefinitely
			resolve();
		};
	});
}

/**
 * Export complete Signal key set for backup to backend
 * Returns all keys needed to restore Signal Protocol state
 */
export async function exportSignalKeys(userId: string): Promise<any> {
	await initSignal(userId);
	const s = getStore();
	
	const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	};

	// Get identity key pair
	const identityKeyPair = await s.getIdentityKeyPair();
	if (!identityKeyPair) throw new Error('No identity key pair found');

	// Get registration ID
	const registrationId = await s.getLocalRegistrationId();
	if (!registrationId) throw new Error('No registration ID found');

	// Get signed prekey (stored with keyId 1)
	const signedPreKey: any = await s.loadSignedPreKey(1);
	if (!signedPreKey) throw new Error('No signed prekey found');

	// Get all prekeys
	const preKeys: any[] = [];
	for (let i = 1; i <= 100; i++) {
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
			keyId: 1,
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
 * Restores all keys to IndexedDB for the current user
 */
export async function importSignalKeys(userId: string, keySet: any): Promise<void> {
	await initSignal(userId);
	const s = getStore();

	const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes.buffer;
	};

	// Store identity key pair
	await s.storeIdentityKeyPair({
		pubKey: base64ToArrayBuffer(keySet.identityKeyPair.pubKey),
		privKey: base64ToArrayBuffer(keySet.identityKeyPair.privKey)
	});

	// Store registration ID
	await s.storeLocalRegistrationId(keySet.registrationId);

	// Store signed prekey (as any for library interop - same as generation code)
	await s.storeSignedPreKey(keySet.signedPreKeyPair.keyId, {
		pubKey: base64ToArrayBuffer(keySet.signedPreKeyPair.keyPair.pubKey),
		privKey: base64ToArrayBuffer(keySet.signedPreKeyPair.keyPair.privKey),
		signature: base64ToArrayBuffer(keySet.signedPreKeyPair.signature)
	} as any);

	// Store all prekeys
	for (const preKey of keySet.preKeys) {
		await s.storePreKey(preKey.keyId, {
			pubKey: base64ToArrayBuffer(preKey.keyPair.pubKey),
			privKey: base64ToArrayBuffer(preKey.keyPair.privKey)
		});
	}

	logger.info('[Signal] Successfully imported keys from backend');
}

/**
 * Initialize Signal Protocol with key restoration from backend if available
 * This should be called during login to ensure consistent keys across tabs/devices
 * 
 * IMPORTANT: Always checks backend first to ensure cross-tab/cross-device consistency.
 * Local keys are only used as fallback if backend fetch fails.
 */
export async function initSignalWithRestore(
	userId: string,
	deviceId: string,
	apiBase: string
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
			logger.info('[Signal] Checking backend for authoritative keys...');
			try {
				const { authService } = await import('$lib/services/auth.service');
				const keySet = await authService.fetchSignalKeys();

				if (keySet) {
					logger.info('[Signal] Found keys on backend, clearing local storage and restoring...');
					
					// Clear local IndexedDB to ensure we start fresh with backend keys
					await clearSignalState(userId);
					
					// Re-initialize store with empty state
					store = new IndexedDBSignalProtocolStore(userId);
					currentUserId = userId;
					initialized = false;
					initializationPromise = null; // Reset initialization promise
					await initSignal(userId);
					
					// Import backend keys
					await importSignalKeys(userId, keySet);
					logger.info('[Signal] Successfully restored keys from backend');
					
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
				
				if (hasKeys) {
					logger.info('[Signal] Found local keys, backing them up to backend...');
					// We have local keys but backend doesn't - back them up
					const existingKeySet = await exportSignalKeys(userId);
					await authService.storeSignalKeys(deviceId, existingKeySet);
					logger.info('[Signal] Successfully backed up local keys to backend');
					return true;
				}

				// No keys anywhere, generate new keys
				logger.info('[Signal] No keys found anywhere, generating new keys...');
				await generateAndPublishIdentity(apiBase, userId, deviceId);

				// Export and store the newly generated keys on backend
				logger.info('[Signal] Backing up newly generated keys to backend...');
				const newKeySet = await exportSignalKeys(userId);
				await authService.storeSignalKeys(deviceId, newKeySet);
				logger.info('[Signal] Successfully backed up keys to backend');

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
 * Remove session with a specific user
 * Useful when encountering MessageCounterError
 */
export async function removeSessionWith(
	targetUserId: string,
	currentUserId_param: string
): Promise<void> {
	await initSignal(currentUserId_param);
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
