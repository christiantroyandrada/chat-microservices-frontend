import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Polyfill btoa/atob for Node test environment
if (typeof (globalThis as any).btoa === 'undefined') {
	(globalThis as any).btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof (globalThis as any).atob === 'undefined') {
	(globalThis as any).atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
}

describe('encryptKeySet / decryptKeySet (mocked WebCrypto)', () => {
	beforeEach(() => {
		// Create a simple deterministic crypto.subtle mock
		const importKey = async (_format: string, keyData: ArrayBuffer | Uint8Array) => {
			// keyData is password bytes; expose as secret
			const secret = new TextDecoder().decode(keyData as ArrayBuffer);
			return { secret } as any;
		};

		const deriveKey = async (
			params: any,
			keyMaterial: any,
			_algo: any,
			_extractable: boolean,
			_usages: string[]
		) => {
			// params.salt is an ArrayBuffer/TypedArray
			const saltArr = Array.from(new Uint8Array(params.salt));
			const secret = `${keyMaterial.secret}:${saltArr.join(',')}`;
			return { secret } as any;
		};

		const encrypt = async (_algo: any, key: any, plaintext: ArrayBuffer) => {
			// produce combined buffer: key.secret + '|' + base64(plaintext)
			const plainBytes = new Uint8Array(plaintext);
			const plainStr = Array.from(plainBytes)
				.map((b) => String.fromCharCode(b))
				.join('');
			const base64Plain = (globalThis as any).btoa(plainStr);
			const combined = `${key.secret}|${base64Plain}`;
			const enc = new TextEncoder().encode(combined);
			return enc.buffer;
		};

		const decrypt = async (_algo: any, key: any, encrypted: ArrayBuffer) => {
			const combined = new TextDecoder().decode(encrypted);
			const [secret, base64Plain] = combined.split('|');
			if (secret !== key.secret) throw new Error('Decryption failed');
			const plainStr = (globalThis as any).atob(base64Plain);
			const bytes = new Uint8Array(plainStr.length);
			for (let i = 0; i < plainStr.length; i++) bytes[i] = plainStr.charCodeAt(i);
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
			vi.unstubAllGlobals();
		} catch {
			// ignore
		}
	});

	it('encrypts and decrypts key set with same password', async () => {
		const { encryptKeySet, decryptKeySet } = await import('$lib/crypto/keyEncryption');

		const keySet = { identityKey: 'id-1', registrationId: 42 } as any;
		const password = 'TestPass#2025';
		const deviceId = 'dev1';

		const bundle = await encryptKeySet(keySet, password, deviceId);
		expect(bundle).toHaveProperty('encrypted');
		expect(bundle.deviceId).toBe(deviceId);

		const decrypted = await decryptKeySet(bundle as any, password);
		expect(decrypted).toEqual(keySet);
	});

	it('fails to decrypt with wrong password', async () => {
		const { encryptKeySet, decryptKeySet } = await import('$lib/crypto/keyEncryption');

		const keySet = { identityKey: 'id-1' } as any;
		const bundle = await encryptKeySet(keySet, 'Correct#1', 'd2');

		await expect(decryptKeySet(bundle as any, 'WrongPassword')).rejects.toThrow(
			/Failed to decrypt keys/
		);
	});
});
