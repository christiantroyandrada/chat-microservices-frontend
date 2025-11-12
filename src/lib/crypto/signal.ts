/* eslint-disable */
/*
 * Signal Protocol implementation using @privacyresearch/libsignal-protocol-typescript
 * Browser-compatible E2EE using pure TypeScript implementation
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
	DeviceType
} from '@privacyresearch/libsignal-protocol-typescript';

export type Identity = {
	publicKey: string;
	privateKey: string;
};

// IndexedDB-backed store implementation
// Implement the StorageType-compatible store expected by the library.
// We purposefully avoid a direct interface implementation here to keep
// the runtime shape correct while being resilient to minor type mismatches.
class IndexedDBSignalProtocolStore {
	private dbName: string;
	private storeName = 'state';
	private db: IDBDatabase | null = null;
	private cache: Record<string, any> = {};

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
			request.onsuccess = (event: any) => {
				const cursor = event.target.result;
				if (cursor) {
					this.cache[cursor.key] = cursor.value;
					cursor.continue();
				} else {
					resolve();
				}
			};
		});
	}

	private async persist(key: string, value: any): Promise<void> {
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
	async getIdentityKeyPair(): Promise<any | undefined> {
		return this.cache['identityKeyPair'] || undefined;
	}

	async getLocalRegistrationId(): Promise<number | undefined> {
		return this.cache['registrationId'] ?? undefined;
	}

	// direction is the enum Direction (1=SENDING,2=RECEIVING) but we accept number to be flexible
	async isTrustedIdentity(
		identifier: string,
		identityKey: ArrayBuffer,
		direction?: number
	): Promise<boolean> {
		const key = `identity_${identifier}`;
		const existing: ArrayBuffer | undefined = this.cache[key];
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
		const existing: ArrayBuffer | undefined = this.cache[key];
		this.cache[key] = publicKey;
		await this.persist(key, publicKey);
		if (!existing) return false;
		return !this.arrayBufferEquals(existing, publicKey);
	}

	// PreKey handling
	async loadPreKey(encodedAddress: string | number): Promise<any | undefined> {
		const id = typeof encodedAddress === 'number' ? encodedAddress : Number(encodedAddress);
		return this.cache[`prekey_${id}`];
	}

	async storePreKey(keyId: number | string, keyPair: any): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		this.cache[`prekey_${id}`] = keyPair;
		await this.persist(`prekey_${id}`, keyPair);
	}

	async removePreKey(keyId: number | string): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		delete this.cache[`prekey_${id}`];
		await this.remove(`prekey_${id}`);
	}

	async loadSignedPreKey(keyId: number | string): Promise<any | undefined> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		return this.cache[`signed_prekey_${id}`];
	}

	async storeSignedPreKey(keyId: number | string, keyPair: any): Promise<void> {
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
		return this.cache[`session_${encodedAddress}`];
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
	async storeIdentityKeyPair(keyPair: any): Promise<void> {
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
}

let store: IndexedDBSignalProtocolStore | null = null;
let initialized = false;
let currentUserId: string | null = null;

export async function initSignal(userId?: string): Promise<void> {
	// If userId is provided and different from current, reinitialize store
	if (userId && userId !== currentUserId) {
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
	await store.init();
	initialized = true;
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

export async function generateSignalIdentity(): Promise<Identity & { _signalBundle?: any }> {
	const storeInstance = getStore();

	// Use KeyHelper from the library to generate keys
	const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
	const registrationId = KeyHelper.generateRegistrationId();

	// Generate one-time prekeys
	const preKeys: Array<{ keyId: number; keyPair: any }> = [];
	for (let i = 1; i <= 5; i++) {
		const pk = await KeyHelper.generatePreKey(i);
		preKeys.push(pk);
	}

	const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);

	// Store locally
	await storeInstance.storeIdentityKeyPair(identityKeyPair);
	await storeInstance.storeLocalRegistrationId(registrationId);
	await storeInstance.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);

	for (const preKey of preKeys) {
		await storeInstance.storePreKey(preKey.keyId, preKey.keyPair);
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

export async function publishSignalPrekey(
	apiBase: string,
	userId: string,
	deviceId: string,
	bundle: any
): Promise<any> {
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
): Promise<any> {
	// Ensure store is initialized for this user before generating identity
	await initSignal(userId);
	const identity = await generateSignalIdentity();
	const bundle = (identity as any)._signalBundle;
	if (!bundle) throw new Error('No generated prekey bundle available');
	return publishSignalPrekey(apiBase, userId, deviceId, bundle);
}

export async function createSessionWithPrekeyBundle(prekeyBundle: any, currentUserId?: string): Promise<void> {
	await initSignal(currentUserId);

	const bundleData = prekeyBundle.bundle || prekeyBundle;
	const userId = prekeyBundle.userId || bundleData.userId || 'unknown';

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
		identityKey: base64ToArrayBuffer(bundleData.identityKey),
		registrationId: bundleData.registrationId
	} as DeviceType;

	if (bundleData.signedPreKey) {
		device.signedPreKey = {
			keyId: bundleData.signedPreKey.id,
			publicKey: base64ToArrayBuffer(bundleData.signedPreKey.publicKey),
			signature: base64ToArrayBuffer(bundleData.signedPreKey.signature)
		} as SignedPublicPreKeyType;
	}

	if (bundleData.preKeys && bundleData.preKeys.length > 0) {
		device.preKey = {
			keyId: bundleData.preKeys[0].id,
			publicKey: base64ToArrayBuffer(bundleData.preKeys[0].publicKey)
		} as PreKeyType;
	}

	const address = new SignalProtocolAddress(userId, 1);
	const sessionBuilder = new SessionBuilder(getStore(), address);
	await sessionBuilder.processPreKey(device);
}

export async function encryptMessage(
	recipientId: string,
	plaintext: string,
	currentUserId?: string
): Promise<{ type: number; body: string }> {
	await initSignal(currentUserId);

	const address = new SignalProtocolAddress(recipientId, 1);
	const sessionCipher = new SessionCipher(getStore(), address);

	const encoder = new TextEncoder();
	const messageBytes = encoder.encode(plaintext);

	const ciphertext = await sessionCipher.encrypt(messageBytes.buffer);

	console.log('[Signal] Encryption result:', {
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
	const body: any = ciphertext.body;

	if (body instanceof ArrayBuffer) {
		console.log('[Signal] Body is ArrayBuffer, converting to base64');
		const bytes = new Uint8Array(body);
		bodyBase64 = btoa(String.fromCharCode(...bytes));
	} else if (typeof body === 'string') {
		// Check if it's already base64 or binary string
		// Binary strings will have characters outside the base64 character set
		const isBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(body);

		if (isBase64 && body.length % 4 === 0) {
			console.log('[Signal] Body is already base64');
			bodyBase64 = body;
		} else {
			console.log('[Signal] Body is binary string, converting to base64');
			// Binary string - convert to base64
			bodyBase64 = btoa(body);
		}
	} else {
		console.error('[Signal] Unexpected body type:', body);
		throw new Error('Unexpected ciphertext body type');
	}

	console.log(
		'[Signal] Final base64 length:',
		bodyBase64.length,
		'first 50 chars:',
		bodyBase64.substring(0, 50)
	);

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

	const address = new SignalProtocolAddress(senderId, 1);
	const sessionCipher = new SessionCipher(getStore(), address);

	let plaintext: ArrayBuffer;

	if (ctType === 3) {
		plaintext = await sessionCipher.decryptPreKeyWhisperMessage(ctBody);
	} else {
		plaintext = await sessionCipher.decryptWhisperMessage(ctBody);
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
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(dbName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			console.log(`[Signal] Deleted database ${dbName}`);
			// Reset the store reference so a new one will be created
			if (currentUserId === userId) {
				store = null;
				initialized = false;
				currentUserId = null;
			}
			resolve();
		};
		request.onblocked = () => {
			console.warn(`[Signal] Database ${dbName} deletion blocked - close all tabs`);
		};
	});
}

/**
 * Remove session with a specific user
 * Useful when encountering MessageCounterError
 */
export async function removeSessionWith(targetUserId: string, currentUserId_param: string): Promise<void> {
	await initSignal(currentUserId_param);
	if (!store) {
		console.warn('[Signal] No store found for user');
		return;
	}
	
	await store.removeAllSessions(targetUserId);
	console.log(`[Signal] Removed all sessions with user ${targetUserId}`);
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
	removeSessionWith
};
