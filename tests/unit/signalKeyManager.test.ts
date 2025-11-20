/* stylelint-disable */
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureBtoaAtob, btoaFromString } from '../utils/polyfills';

ensureBtoaAtob();

import { exportSignalKeys, importSignalKeys } from '$lib/crypto/signalKeyManager';
import { DEFAULT_SIGNED_PREKEY_ID } from '$lib/crypto/signalConstants';

function abFromString(s: string): ArrayBuffer {
	const enc = new TextEncoder();
	return enc.encode(s).buffer;
}

function base64FromString(s: string): string {
	return btoaFromString(s);
}

class InMemoryStore {
	identity?: { pubKey: ArrayBuffer; privKey: ArrayBuffer };
	regId?: number;
	signed = new Map<number, any>();
	pre = new Map<number, any>();

	async storeIdentityKeyPair(pair: { pubKey: ArrayBuffer; privKey: ArrayBuffer }) {
		this.identity = pair;
	}
	async storeLocalRegistrationId(id: number) {
		this.regId = id;
	}
	async storeSignedPreKey(id: number, data: any) {
		this.signed.set(id, data);
	}
	async storePreKey(id: number, kp: any) {
		this.pre.set(id, kp);
	}

	async getIdentityKeyPair() {
		return this.identity;
	}
	async getLocalRegistrationId() {
		return this.regId;
	}
	async loadSignedPreKey(id: number) {
		return this.signed.get(id);
	}
	async loadPreKey(id: number) {
		return this.pre.get(id);
	}
}

describe('signalKeyManager export/import with in-memory store', () => {
	let store: InMemoryStore;

	beforeEach(() => {
		store = new InMemoryStore();
	});

	it('exportSignalKeys throws when identity missing', async () => {
		await expect(exportSignalKeys(store as any)).rejects.toThrow(/No identity key pair/);
	});

	it('exportSignalKeys throws when registration id missing', async () => {
		await store.storeIdentityKeyPair({ pubKey: abFromString('p'), privKey: abFromString('s') });
		await expect(exportSignalKeys(store as any)).rejects.toThrow(/No registration ID/);
	});

	it('exportSignalKeys throws when signed prekey missing', async () => {
		await store.storeIdentityKeyPair({ pubKey: abFromString('p'), privKey: abFromString('s') });
		await store.storeLocalRegistrationId(42);
		await expect(exportSignalKeys(store as any)).rejects.toThrow(/No signed prekey/);
	});

	it('importSignalKeys stores keys and exportSignalKeys returns them', async () => {
		const keySet = {
			identityKeyPair: { pubKey: base64FromString('pub'), privKey: base64FromString('priv') },
			registrationId: 1234,
			signedPreKeyPair: {
				keyId: DEFAULT_SIGNED_PREKEY_ID,
				keyPair: { pubKey: base64FromString('spub'), privKey: base64FromString('spriv') },
				signature: base64FromString('sig')
			},
			preKeys: [
				{ keyId: 1, keyPair: { pubKey: base64FromString('p1'), privKey: base64FromString('q1') } }
			]
		} as any;

		await importSignalKeys(store as any, keySet);

		const exported = await exportSignalKeys(store as any);
		expect(exported.registrationId).toBe(1234);
		expect(exported.identityKeyPair.pubKey).toBe(base64FromString('pub'));
		expect(exported.signedPreKeyPair.keyPair.pubKey).toBe(base64FromString('spub'));
		expect(exported.preKeys.length).toBeGreaterThanOrEqual(1);
	});
});
