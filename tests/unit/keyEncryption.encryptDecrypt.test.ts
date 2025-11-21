import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureBtoaAtob } from '../utils/polyfills';
import { installDeterministicWebCrypto } from '../utils/webcryptoMock';
import type { SignalKeySet, EncryptedKeyBundle } from '$lib/types';

ensureBtoaAtob();

describe('encryptKeySet / decryptKeySet (mocked WebCrypto)', () => {
	let uninstall: (() => void) | undefined;
	beforeEach(() => {
		// Create a simple deterministic crypto.subtle mock
		uninstall = installDeterministicWebCrypto();

		const importKey = async (_format: string, keyData: ArrayBuffer | Uint8Array) => {
			// keyData is password bytes; expose as secret
			const secret = new TextDecoder().decode(keyData as ArrayBuffer);
			return { secret } as { secret: string };
		};

		const deriveKey = async (
			params: { salt: ArrayBuffer | Uint8Array },
			keyMaterial: { secret: string },
			_algo: unknown,
			_extractable: boolean,
			_usages: string[]
		) => {
			// params.salt is an ArrayBuffer/TypedArray
			const saltArr = Array.from(new Uint8Array(params.salt));
			const secret = `${keyMaterial.secret}:${saltArr.join(',')}`;
			return { secret } as { secret: string };
		};

		const b64 = (globalThis as unknown as { btoa?: (s: string) => string }).btoa!;
		const atobFn = (globalThis as unknown as { atob?: (s: string) => string }).atob!;

		const encrypt = async (_algo: unknown, key: { secret: string }, plaintext: ArrayBuffer) => {
			// produce combined buffer: key.secret + '|' + base64(plaintext)
			const plainBytes = new Uint8Array(plaintext);
			const plainStr = Array.from(plainBytes)
				.map((b) => String.fromCodePoint(b))
				.join('');
			const base64Plain = b64(plainStr);
			const combined = `${key.secret}|${base64Plain}`;
			const enc = new TextEncoder().encode(combined);
			return enc.buffer;
		};

		const decrypt = async (_algo: unknown, key: { secret: string }, encrypted: ArrayBuffer) => {
			const combined = new TextDecoder().decode(encrypted);
			const [secret, base64Plain] = combined.split('|');
			if (secret !== key.secret) throw new Error('Decryption failed');
			const plainStr = atobFn(base64Plain);
			const bytes = new Uint8Array(plainStr.length);
			for (let i = 0; i < plainStr.length; i++) bytes[i] = plainStr.codePointAt(i)!;
			return bytes.buffer;
		};

		// Use vi.stubGlobal to safely stub global crypto in the test environment
		vi.stubGlobal('crypto', {
			getRandomValues: (arr: Uint8Array) => {
				// deterministic content: fill with incremental values
				for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
				return arr;
			},
			subtle: {
				importKey,
				deriveKey,
				encrypt,
				decrypt
			}
		} as unknown as typeof globalThis.crypto);
	});

	afterEach(() => {
		// restore any stubbed globals
		try {
			uninstall?.();
		} catch {
			// ignore
		}
	});

	it('encrypts and decrypts key set with same password', async () => {
		const { encryptKeySet, decryptKeySet } = await import('$lib/crypto/keyEncryption');

		const keySet = { identityKey: 'id-1', registrationId: 42 } as unknown as SignalKeySet;
		const password = 'TestPass#2025';
		const deviceId = 'dev1';

		const bundle = await encryptKeySet(keySet, password, deviceId);
		expect(bundle).toHaveProperty('encrypted');
		expect(bundle.deviceId).toBe(deviceId);

		const decrypted = await decryptKeySet(bundle as EncryptedKeyBundle, password);
		expect(decrypted).toEqual(keySet);
	});

	it('fails to decrypt with wrong password', async () => {
		const { encryptKeySet, decryptKeySet } = await import('$lib/crypto/keyEncryption');

		const keySet = { identityKey: 'id-1' } as unknown as SignalKeySet;
		const bundle = await encryptKeySet(keySet, 'Correct#1', 'd2');

		await expect(decryptKeySet(bundle as EncryptedKeyBundle, 'WrongPassword')).rejects.toThrow(
			/Failed to decrypt keys/
		);
	});
});
