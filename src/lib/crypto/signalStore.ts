/**
 * Signal Protocol IndexedDB Storage
 *
 * IndexedDB-backed persistent storage for Signal Protocol keys and sessions
 *
 * @module crypto/signalStore
 */

import type {
	Direction,
	KeyPairType,
	StorageType
} from '@privacyresearch/libsignal-protocol-typescript';
import type { StoredSignedPreKey, SignalCache } from './types';
import { isStoredSignedPreKey } from './types';
import { arrayBufferEquals } from './signalUtils';
import { STORE_NAME, DB_NAME_PREFIX } from './signalConstants';

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
export class IndexedDBSignalProtocolStore {
	private dbName: string;
	private storeName = STORE_NAME;
	private db: IDBDatabase | null = null;
	private cache: SignalCache = {};

	constructor(userId: string) {
		this.dbName = `${DB_NAME_PREFIX}${userId}`;
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

	// ========================================================================
	// StorageType Interface Implementation
	// ========================================================================

	async getIdentityKeyPair(): Promise<KeyPairType<ArrayBuffer> | undefined> {
		return this.cache['identityKeyPair'];
	}

	async getLocalRegistrationId(): Promise<number | undefined> {
		return this.cache['registrationId'];
	}

	async isTrustedIdentity(
		identifier: string,
		identityKey: ArrayBuffer,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		direction?: Direction
	): Promise<boolean> {
		const key = `identity_${identifier}` as const;
		const existing = this.cache[key];
		if (!existing) return true;
		return arrayBufferEquals(existing, identityKey);
	}

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
		return !arrayBufferEquals(existing, publicKey);
	}

	// ========================================================================
	// PreKey Methods
	// ========================================================================

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

	async removePreKey(keyId: number | string): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		const key = `prekey_${id}` as const;
		delete this.cache[key];
		await this.remove(key);
	}

	// ========================================================================
	// Signed PreKey Methods
	// ========================================================================

	async loadSignedPreKey(keyId: number | string): Promise<StoredSignedPreKey | undefined> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		const key = `signed_prekey_${id}` as const;
		const stored = this.cache[key];

		if (!stored) return undefined;
		if (isStoredSignedPreKey(stored)) {
			return stored;
		}

		return undefined;
	}

	async storeSignedPreKey(keyId: number | string, keyData: StoredSignedPreKey): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		const key = `signed_prekey_${id}` as const;
		this.cache[key] = keyData;
		await this.persist(key, keyData);
	}

	async removeSignedPreKey(keyId: number | string): Promise<void> {
		const id = typeof keyId === 'number' ? keyId : Number(keyId);
		const key = `signed_prekey_${id}` as const;
		delete this.cache[key];
		await this.remove(key);
	}

	// ========================================================================
	// Session Storage Methods
	// ========================================================================

	async loadSession(encodedAddress: string): Promise<string | undefined> {
		const key = `session_${encodedAddress}` as const;
		return this.cache[key];
	}

	async storeSession(encodedAddress: string, record: string): Promise<void> {
		const key = `session_${encodedAddress}` as const;
		this.cache[key] = record;
		await this.persist(key, record);
	}

	async removeSession(encodedAddress: string): Promise<void> {
		const key = `session_${encodedAddress}` as const;
		delete this.cache[key];
		await this.remove(key);
	}

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

	async storeIdentityKeyPair(keyPair: KeyPairType<ArrayBuffer>): Promise<void> {
		this.cache['identityKeyPair'] = keyPair;
		await this.persist('identityKeyPair', keyPair);
	}

	async storeLocalRegistrationId(registrationId: number): Promise<void> {
		this.cache['registrationId'] = registrationId;
		await this.persist('registrationId', registrationId);
	}

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			this.cache = {};
		}
	}

	getDbName(): string {
		return this.dbName;
	}

	// Cast to StorageType for library compatibility
	asStorageType(): StorageType {
		return this as unknown as StorageType;
	}
}
