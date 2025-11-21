import { vi, describe, it, expect, beforeEach } from 'vitest';

// module under test
import * as keyManager from '$lib/crypto/signalKeyManager';

// constants used in module
import { DEFAULT_SIGNED_PREKEY_ID, PREKEY_COUNT } from '$lib/crypto/signalConstants';

// Mock the dev logger used inside the module
vi.mock('$lib/services/dev-logger', () => ({
	logger: { info: vi.fn(), warning: vi.fn() }
}));

// Mock KeyHelper from libsignal so we can control generated keys
const makeArrayBuffer = (seed: number) => new Uint8Array([seed, seed + 1, seed + 2]).buffer;
vi.mock('@privacyresearch/libsignal-protocol-typescript', () => ({
	KeyHelper: {
		generateIdentityKeyPair: vi.fn(async () => ({
			pubKey: makeArrayBuffer(1),
			privKey: makeArrayBuffer(2)
		})),
		generateRegistrationId: vi.fn(() => 42),
		generatePreKey: vi.fn(async (id: number) => ({
			keyId: id,
			keyPair: { pubKey: makeArrayBuffer(id), privKey: makeArrayBuffer(id + 1) }
		})),
		generateSignedPreKey: vi.fn(async (identityKeyPair: any, keyId: number) => ({
			keyId,
			keyPair: { pubKey: makeArrayBuffer(99), privKey: makeArrayBuffer(100) },
			signature: makeArrayBuffer(101)
		}))
	}
}));

describe('signalKeyManager', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('generateSignalIdentity stores keys and returns identity with bundle', async () => {
		const store = {
			storeIdentityKeyPair: vi.fn().mockResolvedValue(undefined),
			storeLocalRegistrationId: vi.fn().mockResolvedValue(undefined),
			storeSignedPreKey: vi.fn().mockResolvedValue(undefined),
			storePreKey: vi.fn().mockResolvedValue(undefined)
		} as any;

		const result = await keyManager.generateSignalIdentity(store);

		// bundle should exist
		expect(result._signalBundle).toBeDefined();
		expect(typeof result._signalBundle.identityKey).toBe('string');
		expect(result._signalBundle.preKeys.length).toBe(PREKEY_COUNT);

		// ensure store was called for identity, registration, signed prekey and prekeys
		expect(store.storeIdentityKeyPair).toHaveBeenCalled();
		expect(store.storeLocalRegistrationId).toHaveBeenCalled();
		expect(store.storeSignedPreKey).toHaveBeenCalledWith(
			DEFAULT_SIGNED_PREKEY_ID,
			expect.any(Object)
		);
		expect(store.storePreKey).toHaveBeenCalled();
	});

	it('publishSignalPrekey posts bundle and returns response on success', async () => {
		const fakeResp = { success: true };
		// mock fetch to be successful
		(global as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fakeResp });

		const bundle = {
			identityKey: 'a',
			registrationId: 1,
			signedPreKey: { id: 1, publicKey: 'b', signature: 'c' },
			preKeys: []
		};
		const res = await keyManager.publishSignalPrekey('https://api', 'u', 'd', bundle as any);

		expect((global as any).fetch).toHaveBeenCalled();
		expect(res).toEqual(fakeResp);
	});

	it('publishSignalPrekey throws when server responds non-ok', async () => {
		(global as any).fetch = vi.fn().mockResolvedValue({ ok: false, statusText: 'Bad' });

		const bundle = {
			identityKey: 'a',
			registrationId: 1,
			signedPreKey: { id: 1, publicKey: 'b', signature: 'c' },
			preKeys: []
		};
		await expect(
			keyManager.publishSignalPrekey('https://api', 'u', 'd', bundle as any)
		).rejects.toThrow('Failed to publish prekey');
	});

	it('exportSignalKeys returns keys when present', async () => {
		// make a store that returns identity, registration, signed prekey and two prekeys
		const identity = { pubKey: makeArrayBuffer(5), privKey: makeArrayBuffer(6) };
		const signed = {
			pubKey: makeArrayBuffer(7),
			privKey: makeArrayBuffer(8),
			signature: makeArrayBuffer(9)
		};

		const store = {
			getIdentityKeyPair: vi.fn().mockResolvedValue(identity),
			getLocalRegistrationId: vi.fn().mockResolvedValue(321),
			loadSignedPreKey: vi.fn().mockResolvedValue(signed),
			loadPreKey: vi.fn().mockImplementation(async (id: number) => {
				if (id <= 2) return { pubKey: makeArrayBuffer(id), privKey: makeArrayBuffer(id + 10) };
				return null;
			})
		} as any;

		const keys = await keyManager.exportSignalKeys(store);
		expect(keys.identityKeyPair.pubKey).toBeTypeOf('string');
		expect(keys.registrationId).toBe(321);
		expect(keys.signedPreKeyPair.keyId).toBe(DEFAULT_SIGNED_PREKEY_ID);
		expect(Array.isArray(keys.preKeys)).toBe(true);
		expect(keys.preKeys.length).toBe(2);
	});

	it('exportSignalKeys throws when identity missing', async () => {
		const store = { getIdentityKeyPair: vi.fn().mockResolvedValue(null) } as any;
		await expect(keyManager.exportSignalKeys(store)).rejects.toThrow('No identity key pair found');
	});

	it('exportSignalKeys throws when registration missing', async () => {
		const identity = { pubKey: makeArrayBuffer(1), privKey: makeArrayBuffer(2) };
		const store = {
			getIdentityKeyPair: vi.fn().mockResolvedValue(identity),
			getLocalRegistrationId: vi.fn().mockResolvedValue(undefined)
		} as any;
		await expect(keyManager.exportSignalKeys(store)).rejects.toThrow('No registration ID found');
	});

	it('exportSignalKeys throws when signed prekey invalid', async () => {
		const identity = { pubKey: makeArrayBuffer(1), privKey: makeArrayBuffer(2) };
		const store = {
			getIdentityKeyPair: vi.fn().mockResolvedValue(identity),
			getLocalRegistrationId: vi.fn().mockResolvedValue(1),
			loadSignedPreKey: vi.fn().mockResolvedValue({ not: 'valid' })
		} as any;
		await expect(keyManager.exportSignalKeys(store)).rejects.toThrow(
			'No signed prekey found or invalid format'
		);
	});

	it('importSignalKeys stores keys and calls logger', async () => {
		// simple base64 strings for small buffers
		const b1 = Buffer.from([1, 2, 3]).toString('base64');
		const b2 = Buffer.from([4, 5, 6]).toString('base64');

		const keySet = {
			identityKeyPair: { pubKey: b1, privKey: b2 },
			registrationId: 99,
			signedPreKeyPair: {
				keyId: DEFAULT_SIGNED_PREKEY_ID,
				keyPair: { pubKey: b1, privKey: b2 },
				signature: b1
			},
			preKeys: [
				{ keyId: 1, keyPair: { pubKey: b1, privKey: b2 } },
				{ keyId: 2, keyPair: { pubKey: b1, privKey: b2 } }
			]
		} as any;

		const store = {
			storeIdentityKeyPair: vi.fn().mockResolvedValue(undefined),
			storeLocalRegistrationId: vi.fn().mockResolvedValue(undefined),
			storeSignedPreKey: vi.fn().mockResolvedValue(undefined),
			storePreKey: vi.fn().mockResolvedValue(undefined)
		} as any;

		await keyManager.importSignalKeys(store, keySet);

		expect(store.storeIdentityKeyPair).toHaveBeenCalled();
		expect(store.storeLocalRegistrationId).toHaveBeenCalledWith(99);
		expect(store.storeSignedPreKey).toHaveBeenCalledWith(
			DEFAULT_SIGNED_PREKEY_ID,
			expect.any(Object)
		);
		expect(store.storePreKey).toHaveBeenCalledTimes(2);
	});
});
/* stylelint-disable */
import { ensureBtoaAtob, btoaFromString } from '../utils/polyfills';

ensureBtoaAtob();

import { exportSignalKeys, importSignalKeys } from '$lib/crypto/signalKeyManager';

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
