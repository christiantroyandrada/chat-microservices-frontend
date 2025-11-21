import { vi, describe, it, expect, beforeEach } from 'vitest';

import type { EncryptedKeyBundle } from '$lib/types';

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
		} as any;

		const result = await signalBackup.hasLocalKeys(store);
		expect(result).toBe(true);
		expect(store.getIdentityKeyPair).toHaveBeenCalled();
		expect(store.loadSignedPreKey).toHaveBeenCalled();
	});

	it('hasLocalKeys returns false when missing keys', async () => {
		const store = {
			getIdentityKeyPair: vi.fn().mockResolvedValue(null),
			loadSignedPreKey: vi.fn().mockResolvedValue(null)
		} as any;

		const result = await signalBackup.hasLocalKeys(store);
		expect(result).toBe(false);
	});

	it('exportAndEncryptSignalKeys calls export and encrypt and returns bundle', async () => {
		const fakePlain = { keys: 'plain' };
		const fakeEncrypted: EncryptedKeyBundle = { deviceId: 'dev1', cipher: 'abc' } as any;

		(exportSignalKeys as any).mockResolvedValue(fakePlain);
		(encryptKeySet as any).mockResolvedValue(fakeEncrypted);

		const store = {} as any;
		const res = await signalBackup.exportAndEncryptSignalKeys(store, 'dev1', 'pw');

		expect(exportSignalKeys).toHaveBeenCalledWith(store);
		expect(encryptKeySet).toHaveBeenCalledWith(fakePlain, 'pw', 'dev1');
		expect(res).toBe(fakeEncrypted);
	});

	it('decryptAndImportSignalKeys decrypts and imports keys', async () => {
		const fakePlain = { keys: 'plain' };
		const fakeBundle = { deviceId: 'dev1' } as any;

		(decryptKeySet as any).mockResolvedValue(fakePlain);
		(importSignalKeys as any).mockResolvedValue(undefined);

		const store = {} as any;
		await signalBackup.decryptAndImportSignalKeys(store, fakeBundle, 'pw');

		expect(decryptKeySet).toHaveBeenCalledWith(fakeBundle, 'pw');
		expect(importSignalKeys).toHaveBeenCalledWith(store, fakePlain);
	});

	it('clearSignalState resolves on success and calls indexedDB.deleteDatabase', async () => {
		// stub indexedDB.deleteDatabase to call onsuccess
		(global as any).indexedDB = {
			deleteDatabase: () => {
				const req: any = {};
				setTimeout(() => {
					if (req.onsuccess) req.onsuccess();
				}, 0);
				return req;
			}
		};

		await expect(signalBackup.clearSignalState('user123')).resolves.toBeUndefined();
	});

	it('generateAndPublishIdentity returns publish result when bundle exists', async () => {
		const fakeBundle = { something: true };
		(generateSignalIdentity as any).mockResolvedValue({ _signalBundle: fakeBundle });
		(publishSignalPrekey as any).mockResolvedValue({ ok: true });

		const res = await signalBackup.generateAndPublishIdentity(
			{} as any,
			'https://api',
			'user1',
			'dev1'
		);
		expect(generateSignalIdentity).toHaveBeenCalled();
		expect(publishSignalPrekey).toHaveBeenCalledWith('https://api', 'user1', 'dev1', fakeBundle);
		expect(res).toEqual({ ok: true });
	});

	it('generateAndPublishIdentity throws when no bundle present', async () => {
		(generateSignalIdentity as any).mockResolvedValue({});
		await expect(signalBackup.generateAndPublishIdentity({} as any, '', 'u', 'd')).rejects.toThrow(
			'No generated prekey bundle available'
		);
	});
});
