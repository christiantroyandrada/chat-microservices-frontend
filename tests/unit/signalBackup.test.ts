import { vi, describe, it, expect, beforeEach, type MockedFunction } from 'vitest';

import type { EncryptedKeyBundle, SignalKeySet } from '$lib/types';
import type { IndexedDBSignalProtocolStore } from '$lib/crypto/signalStore';

// module under test
import * as signalBackup from '$lib/crypto/signalBackup';

// mock the dependent modules
vi.mock('$lib/crypto/signalKeyManager', () => ({
	exportSignalKeys: vi.fn(),
	importSignalKeys: vi.fn(),
	generateSignalIdentity: vi.fn(),
	publishSignalPrekey: vi.fn()
}));

vi.mock('$lib/crypto/keyEncryption', () => ({
	encryptKeySet: vi.fn(),
	decryptKeySet: vi.fn()
}));

vi.mock('$lib/services/dev-logger', () => ({
	logger: {
		info: vi.fn(),
		warning: vi.fn()
	}
}));

import {
	exportSignalKeys,
	importSignalKeys,
	generateSignalIdentity,
	publishSignalPrekey
} from '$lib/crypto/signalKeyManager';
import { encryptKeySet, decryptKeySet } from '$lib/crypto/keyEncryption';

describe('signalBackup', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('hasLocalKeys returns true when both identity and signed prekey exist', async () => {
		const store = {
			getIdentityKeyPair: vi.fn().mockResolvedValue({ pubKey: 'x' }),
			loadSignedPreKey: vi.fn().mockResolvedValue({ id: 1 })
		} as unknown as IndexedDBSignalProtocolStore;

		const result = await signalBackup.hasLocalKeys(store);
		expect(result).toBe(true);
		expect(store.getIdentityKeyPair).toHaveBeenCalled();
		expect(store.loadSignedPreKey).toHaveBeenCalled();
	});

	it('hasLocalKeys returns false when missing keys', async () => {
		const store = {
			getIdentityKeyPair: vi.fn().mockResolvedValue(null),
			loadSignedPreKey: vi.fn().mockResolvedValue(null)
		} as unknown as IndexedDBSignalProtocolStore;

		const result = await signalBackup.hasLocalKeys(store);
		expect(result).toBe(false);
	});

	it('exportAndEncryptSignalKeys calls export and encrypt and returns bundle', async () => {
		const fakePlain = {} as unknown as SignalKeySet;
		const fakeEncrypted = {
			deviceId: 'dev1',
			encrypted: 'e',
			iv: 'i',
			salt: 's',
			version: 1
		} as unknown as EncryptedKeyBundle;

		const exportMock = exportSignalKeys as MockedFunction<typeof exportSignalKeys>;
		const encryptMock = encryptKeySet as MockedFunction<typeof encryptKeySet>;
		exportMock.mockResolvedValue(fakePlain);
		encryptMock.mockResolvedValue(fakeEncrypted);

		const store = {} as unknown as IndexedDBSignalProtocolStore;
		const res = await signalBackup.exportAndEncryptSignalKeys(store, 'dev1', 'pw');

		expect(exportSignalKeys).toHaveBeenCalledWith(store);
		expect(encryptKeySet).toHaveBeenCalledWith(fakePlain, 'pw', 'dev1');
		expect(res).toBe(fakeEncrypted);
	});

	it('decryptAndImportSignalKeys decrypts and imports keys', async () => {
		const fakePlain2 = {} as unknown as SignalKeySet;
		const fakeBundle = {
			deviceId: 'dev1',
			encrypted: 'e',
			iv: 'i',
			salt: 's',
			version: 1
		} as unknown as EncryptedKeyBundle;

		const decryptMock = decryptKeySet as MockedFunction<typeof decryptKeySet>;
		const importMock = importSignalKeys as MockedFunction<typeof importSignalKeys>;
		decryptMock.mockResolvedValue(fakePlain2);
		importMock.mockResolvedValue(undefined);

		const store = {} as unknown as IndexedDBSignalProtocolStore;
		await signalBackup.decryptAndImportSignalKeys(store, fakeBundle, 'pw');

		expect(decryptKeySet).toHaveBeenCalledWith(fakeBundle, 'pw');
		expect(importSignalKeys).toHaveBeenCalledWith(store, fakePlain2);
	});

	it('clearSignalState resolves on success and calls indexedDB.deleteDatabase', async () => {
		// stub indexedDB.deleteDatabase to call onsuccess
		(global as unknown as { indexedDB?: { deleteDatabase: () => unknown } }).indexedDB = {
			deleteDatabase: () => {
				const req: { onsuccess?: () => void } = {};
				setTimeout(() => {
					if (req.onsuccess) req.onsuccess();
				}, 0);
				return req;
			}
		} as unknown as { deleteDatabase: () => unknown };

		await expect(signalBackup.clearSignalState('user123')).resolves.toBeUndefined();
	});

	it('generateAndPublishIdentity returns publish result when bundle exists', async () => {
		const fakeBundle = { something: true } as unknown as SignalKeySet;
		const genMock = generateSignalIdentity as MockedFunction<typeof generateSignalIdentity>;
		const pubMock = publishSignalPrekey as MockedFunction<typeof publishSignalPrekey>;
		genMock.mockResolvedValue({ _signalBundle: fakeBundle } as unknown as Awaited<
			ReturnType<typeof generateSignalIdentity>
		>);
		pubMock.mockResolvedValue({ ok: true } as unknown as Awaited<
			ReturnType<typeof publishSignalPrekey>
		>);

		const res = await signalBackup.generateAndPublishIdentity(
			{} as unknown as IndexedDBSignalProtocolStore,
			'https://api',
			'user1',
			'dev1'
		);
		expect(generateSignalIdentity).toHaveBeenCalled();
		expect(publishSignalPrekey).toHaveBeenCalledWith('https://api', 'user1', 'dev1', fakeBundle);
		expect(res).toEqual({ ok: true });
	});

	it('generateAndPublishIdentity throws when no bundle present', async () => {
		const genMock2 = generateSignalIdentity as MockedFunction<typeof generateSignalIdentity>;
		genMock2.mockResolvedValue({} as unknown as Awaited<ReturnType<typeof generateSignalIdentity>>);
		await expect(
			signalBackup.generateAndPublishIdentity(
				{} as unknown as IndexedDBSignalProtocolStore,
				'',
				'u',
				'd'
			)
		).rejects.toThrow('No generated prekey bundle available');
	});
});
