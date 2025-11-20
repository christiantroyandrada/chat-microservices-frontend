// Removed duplicate import
// (imports consolidated)
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { IndexedDBSignalProtocolStore } from '$lib/crypto/signalStore';
import { attachFakeStoreTo } from '../utils/fakeIndexedDB';
import { DEFAULT_SIGNED_PREKEY_ID } from '$lib/crypto/signalConstants';

function abFrom(arr: number[]) {
	return new Uint8Array(arr).buffer;
}

describe('IndexedDBSignalProtocolStore', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('stores and retrieves identity key pair and registration id', async () => {
		const store = new IndexedDBSignalProtocolStore('u1');
		attachFakeStoreTo(store, vi);

		const kp = { pubKey: abFrom([1, 2, 3]), privKey: abFrom([4, 5, 6]) } as unknown as {
			pubKey: ArrayBuffer;
			privKey: ArrayBuffer;
		};
		await store.storeIdentityKeyPair(kp);
		await store.storeLocalRegistrationId(1234);

		const got = await store.getIdentityKeyPair();
		const reg = await store.getLocalRegistrationId();

		expect(got).toEqual(kp);
		expect(reg).toBe(1234);
	});

	it('stores, loads and removes prekeys', async () => {
		const store = new IndexedDBSignalProtocolStore('u2');
		attachFakeStoreTo(store, vi);

		const kp = { pubKey: abFrom([7]), privKey: abFrom([8]) } as unknown as {
			pubKey: ArrayBuffer;
			privKey: ArrayBuffer;
		};
		await store.storePreKey(1, kp);

		const loaded = await store.loadPreKey(1);
		expect(loaded).toEqual(kp);

		await store.removePreKey(1);
		const after = await store.loadPreKey(1);
		expect(after).toBeUndefined();
	});

	it('stores, loads and removes signed prekey with proper type guard', async () => {
		const store = new IndexedDBSignalProtocolStore('u3');
		attachFakeStoreTo(store, vi);

		const signed = {
			pubKey: abFrom([9]),
			privKey: abFrom([10]),
			signature: abFrom([11])
		} as unknown as {
			pubKey: ArrayBuffer;
			privKey: ArrayBuffer;
			signature: ArrayBuffer;
		};
		await store.storeSignedPreKey(DEFAULT_SIGNED_PREKEY_ID, signed);

		const loaded = await store.loadSignedPreKey(DEFAULT_SIGNED_PREKEY_ID);
		expect(loaded).toEqual(signed);

		await store.removeSignedPreKey(DEFAULT_SIGNED_PREKEY_ID);
		const after = await store.loadSignedPreKey(DEFAULT_SIGNED_PREKEY_ID);
		expect(after).toBeUndefined();
	});

	it('stores, loads, removes and clears sessions', async () => {
		const store = new IndexedDBSignalProtocolStore('u4');
		attachFakeStoreTo(store, vi);

		await store.storeSession('alice:1', 'rec1');
		await store.storeSession('alice:2', 'rec2');

		expect(await store.loadSession('alice:1')).toBe('rec1');
		expect(await store.loadSession('alice:2')).toBe('rec2');

		await store.removeSession('alice:1');
		expect(await store.loadSession('alice:1')).toBeUndefined();

		// removeAllSessions for prefix 'alice' should delete remaining session keys
		await store.removeAllSessions('alice');
		expect(await store.loadSession('alice:2')).toBeUndefined();
	});

	it('saveIdentity and isTrustedIdentity behave correctly', async () => {
		const store = new IndexedDBSignalProtocolStore('u5');
		attachFakeStoreTo(store, vi);

		const keyA = abFrom([1]);
		const keyB = abFrom([2]);

		// first save returns false (no existing)
		const first = await store.saveIdentity('bob', keyA);
		expect(first).toBe(false);

		// same key returns false (no change)
		const second = await store.saveIdentity('bob', keyA);
		expect(second).toBe(false);

		// different key returns true (changed)
		const third = await store.saveIdentity('bob', keyB);
		expect(third).toBe(true);

		// isTrustedIdentity returns false when different
		const trusted = await store.isTrustedIdentity('bob', keyA);
		expect(trusted).toBe(false);

		// trusted for matching key
		const trusted2 = await store.isTrustedIdentity('bob', keyB);
		expect(trusted2).toBe(true);
	});

	it('close resets db and cache', async () => {
		const store = new IndexedDBSignalProtocolStore('u6');
		attachFakeStoreTo(store, vi);

		await store.storeLocalRegistrationId(55);
		expect(await store.getLocalRegistrationId()).toBe(55);
		// ensure fake db has a close method to match real IDBDatabase
		const storeDb = store as unknown as { db?: { close?: unknown } };
		if (storeDb.db && typeof storeDb.db.close !== 'function') {
			// assign a close function; cast to the expected type
			(storeDb.db as { close?: () => void }).close = vi.fn() as unknown as () => void;
		}

		store.close();
		expect(store.getDbName()).toContain('signal-protocol-store-');
		// after close cache should be empty and db null; subsequent get returns undefined
		expect(await store.getLocalRegistrationId()).toBeUndefined();
	});
});

/* Second suite: run against an instance with IDB methods stubbed out */
function abFromString(s: string): ArrayBuffer {
	return new TextEncoder().encode(s).buffer;
}

describe('IndexedDBSignalProtocolStore (unit, no IDB)', () => {
	let store: IndexedDBSignalProtocolStore;

	beforeEach(() => {
		store = new IndexedDBSignalProtocolStore('test-user');

		// Stub out IDB access: init/loadCache/persist/remove should be no-ops
		vi.spyOn(store as unknown as { init: () => Promise<void> }, 'init').mockImplementation(
			async () => {}
		);
		vi.spyOn(
			store as unknown as { loadCache: () => Promise<void> },
			'loadCache'
		).mockImplementation(async () => {});
		vi.spyOn(
			store as unknown as { persist: (...args: unknown[]) => unknown },
			'persist'
		).mockImplementation((..._args: unknown[]) => undefined);
		vi.spyOn(
			store as unknown as { remove: (...args: unknown[]) => unknown },
			'remove'
		).mockImplementation((..._args: unknown[]) => undefined);
	});

	it('stores and retrieves identity key pair and registration id', async () => {
		const kp = { pubKey: abFromString('p'), privKey: abFromString('q') } as unknown as {
			pubKey: ArrayBuffer;
			privKey: ArrayBuffer;
		};
		await store.storeIdentityKeyPair(kp);
		expect(await store.getIdentityKeyPair()).toBe(kp);

		await store.storeLocalRegistrationId(4242);
		expect(await store.getLocalRegistrationId()).toBe(4242);
	});

	it('stores, loads and removes prekeys', async () => {
		const keyPair = { pubKey: abFromString('a'), privKey: abFromString('b') } as unknown as {
			pubKey: ArrayBuffer;
			privKey: ArrayBuffer;
		};
		await store.storePreKey(5, keyPair);
		expect(await store.loadPreKey(5)).toBe(keyPair);

		await store.removePreKey(5);
		expect(await store.loadPreKey(5)).toBeUndefined();
	});

	it('stores, loads and removes signed prekeys', async () => {
		const sp = {
			pubKey: abFromString('x'),
			privKey: abFromString('y'),
			signature: abFromString('sig')
		} as unknown as {
			pubKey: ArrayBuffer;
			privKey: ArrayBuffer;
			signature: ArrayBuffer;
		};
		await store.storeSignedPreKey(7, sp);
		const loaded = await store.loadSignedPreKey(7);
		expect(loaded).toBeDefined();

		await store.removeSignedPreKey(7);
		expect(await store.loadSignedPreKey(7)).toBeUndefined();
	});

	it('stores, loads, removes and clears sessions', async () => {
		await store.storeSession('addr:1', 'record-1');
		expect(await store.loadSession('addr:1')).toBe('record-1');

		await store.storeSession('addr:1:device', 'rec-2');
		expect(await store.loadSession('addr:1:device')).toBe('rec-2');

		await store.removeSession('addr:1');
		expect(await store.loadSession('addr:1')).toBeUndefined();

		// add multiple sessions and removeAllSessions
		await store.storeSession('session_prefix:keep', 'v1');
		await store.storeSession('session_prefix:keep:1', 'v2');
		await store.removeAllSessions('session_prefix');
		expect(await store.loadSession('session_prefix:keep')).toBeUndefined();
	});

	it('isTrustedIdentity and saveIdentity behavior', async () => {
		const id = 'user@example';
		const pub = abFromString('pub');

		// no existing identity => trusted
		expect(await store.isTrustedIdentity(id, pub)).toBe(true);

		// save identity (first save should return false -> meaning not changed)
		const changed = await store.saveIdentity(id, pub);
		expect(changed).toBe(false);

		// saving same key returns false (no change)
		const changed2 = await store.saveIdentity(id, pub);
		expect(changed2).toBe(false);

		// saving different key returns true (changed)
		const other = abFromString('other');
		const changed3 = await store.saveIdentity(id, other);
		expect(changed3).toBe(true);
	});
});
