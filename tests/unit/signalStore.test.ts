import { describe, it, expect, beforeEach, vi } from 'vitest';

/* stylelint-disable */

import { IndexedDBSignalProtocolStore } from '$lib/crypto/signalStore';

function abFromString(s: string): ArrayBuffer {
	return new TextEncoder().encode(s).buffer;
}

describe('IndexedDBSignalProtocolStore (unit, no IDB)', () => {
	let store: IndexedDBSignalProtocolStore;

	beforeEach(() => {
		store = new IndexedDBSignalProtocolStore('test-user');

		// Stub out IDB access: init/loadCache/persist/remove should be no-ops
		vi.spyOn(store as any, 'init').mockImplementation(async () => {});
		vi.spyOn(store as any, 'loadCache').mockImplementation(async () => {});
		vi.spyOn(store as any, 'persist').mockImplementation(async (..._args: any[]) =>
			Promise.resolve()
		);
		vi.spyOn(store as any, 'remove').mockImplementation(async (..._args: any[]) =>
			Promise.resolve()
		);
	});

	it('stores and retrieves identity key pair and registration id', async () => {
		const kp = { pubKey: abFromString('p'), privKey: abFromString('q') } as any;
		await store.storeIdentityKeyPair(kp);
		expect(await store.getIdentityKeyPair()).toBe(kp);

		await store.storeLocalRegistrationId(4242);
		expect(await store.getLocalRegistrationId()).toBe(4242);
	});

	it('stores, loads and removes prekeys', async () => {
		const keyPair = { pubKey: abFromString('a'), privKey: abFromString('b') } as any;
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
		} as any;
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
