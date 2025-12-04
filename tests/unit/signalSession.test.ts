/* stylelint-disable */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the libsignal protocol pieces used by the module under test
vi.mock('@privacyresearch/libsignal-protocol-typescript', () => {
	const EncryptionResultMessageType = { WhisperMessage: 1, PreKeyWhisperMessage: 3 };

	class SignalProtocolAddress {
		constructor(
			public name: string,
			public deviceId: number
		) {}
		toString() {
			return `${this.name}:${this.deviceId}`;
		}
	}

	class SessionBuilder {
		async processPreKey(_device: unknown) {
			// default no-op, tests can spyOn prototype to change behavior
		}
	}

	class SessionCipher {
		async encrypt(_buf: ArrayBuffer) {
			return { type: 1, body: 'AAAA' };
		}
		async decryptPreKeyWhisperMessage(_buf: ArrayBuffer, _format: string) {
			const enc = new TextEncoder();
			return enc.encode('decrypted-prekey').buffer;
		}
		async decryptWhisperMessage(_buf: ArrayBuffer, _format: string) {
			const enc = new TextEncoder();
			return enc.encode('decrypted-whisper').buffer;
		}
	}

	return { SignalProtocolAddress, SessionBuilder, SessionCipher, EncryptionResultMessageType };
});

import {
	createSessionWithPrekeyBundle,
	encryptMessage,
	decryptMessage,
	hasSession,
	removeSessionWith
} from '$lib/crypto/signalSession';

// Note: tests will cast fake stores to the actual function parameter types using
// `Parameters<typeof fn>[0]` to avoid referencing `any` or external store types.

function base64ToArrayBuffer(b64: string) {
	const bin = Buffer.from(b64, 'base64');
	return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
}

describe('signalSession', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('createSessionWithPrekeyBundle throws on missing fields', async () => {
		await expect(
			createSessionWithPrekeyBundle(
				{} as unknown as Parameters<typeof createSessionWithPrekeyBundle>[0],
				{}
			)
		).rejects.toThrow(TypeError);
	});

	it('createSessionWithPrekeyBundle throws when signedPreKey missing', async () => {
		const payload = { bundle: { identityKey: 'AAA', registrationId: 1 } };
		await expect(
			createSessionWithPrekeyBundle(
				{} as unknown as Parameters<typeof createSessionWithPrekeyBundle>[0],
				payload
			)
		).rejects.toThrow(/signed prekey/);
	});

	it('createSessionWithPrekeyBundle calls processPreKey', async () => {
		const builderProto = (await import('@privacyresearch/libsignal-protocol-typescript'))
			.SessionBuilder.prototype as unknown as {
			processPreKey: (...args: unknown[]) => Promise<void>;
		};
		const spy = vi.spyOn(builderProto, 'processPreKey').mockResolvedValue(undefined);

		const signed = { id: 1, publicKey: 'QQQ', signature: 'SSS' };
		const payload = { bundle: { identityKey: 'AAA', registrationId: 2, signedPreKey: signed } };

		const fakeStore = { asStorageType: () => ({}) } as unknown as Parameters<
			typeof createSessionWithPrekeyBundle
		>[0];
		await expect(createSessionWithPrekeyBundle(fakeStore, payload)).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
	});

	it('encryptMessage handles ArrayBuffer body', async () => {
		const fakeStore = { asStorageType: () => ({}) } as unknown as Parameters<
			typeof encryptMessage
		>[0];
		// Stub SessionCipher.encrypt to return ArrayBuffer body
		const libc = await import('@privacyresearch/libsignal-protocol-typescript');
		(
			libc.SessionCipher.prototype as unknown as {
				encrypt?: (...args: unknown[]) => Promise<unknown>;
			}
		).encrypt = vi.fn().mockResolvedValue({
			type: 1,
			body: base64ToArrayBuffer('QUJD')
		});

		const result = await encryptMessage(fakeStore, 'user-x', 'hello');
		expect(result.type).toBe(1);
		expect(typeof result.body).toBe('string');
		expect(result.body.length).toBeGreaterThan(0);
	});

	it('encryptMessage handles string base64 body', async () => {
		const fakeStore = { asStorageType: () => ({}) } as unknown as Parameters<
			typeof encryptMessage
		>[0];
		const libc2 = await import('@privacyresearch/libsignal-protocol-typescript');
		(
			libc2.SessionCipher.prototype as unknown as {
				encrypt?: (...args: unknown[]) => Promise<unknown>;
			}
		).encrypt = vi.fn().mockResolvedValue({ type: 1, body: 'AAAA' });

		const res = await encryptMessage(fakeStore, 'u', 'hi');
		expect(res.body).toBe('AAAA');
	});

	it('decryptMessage handles string (legacy) and object forms', async () => {
		const fakeStore = {
			asStorageType: () => ({}),
			loadSession: async () => undefined,
			getIdentityKeyPair: async () => ({
				pubKey: new ArrayBuffer(32),
				privKey: new ArrayBuffer(32)
			}),
			loadSignedPreKey: async () => ({
				keyId: 1,
				keyPair: { pubKey: new ArrayBuffer(32), privKey: new ArrayBuffer(32) }
			})
		} as unknown as Parameters<typeof decryptMessage>[0];

		// For PreKey (string) path
		const encStr = 'QUJD'; // base64 'ABC'
		const dec = await decryptMessage(fakeStore, 'sender', encStr);
		expect(dec).toBeDefined();

		// For object path (WhisperMessage)
		const obj = { type: 1, body: 'QUJD' } as unknown;
		const dec2 = await decryptMessage(
			fakeStore,
			'sender',
			obj as Parameters<typeof decryptMessage>[2]
		);
		expect(dec2).toBeDefined();
	});

	it('hasSession and removeSessionWith delegate to store', async () => {
		const fakeStore2 = {
			asStorageType: () => ({}),
			loadSession: async () => 'rec',
			removeAllSessions: vi.fn()
		} as unknown as Parameters<typeof hasSession>[0];
		expect(await hasSession(fakeStore2, 'u')).toBe(true);
		await removeSessionWith(fakeStore2, 'u');
		expect(
			(fakeStore2 as unknown as { removeAllSessions: ReturnType<typeof vi.fn> }).removeAllSessions
		).toHaveBeenCalledWith('u');
	});

	it('hasSession returns false when no session exists', async () => {
		const fakeStore = {
			asStorageType: () => ({}),
			loadSession: async () => null
		} as unknown as Parameters<typeof hasSession>[0];
		expect(await hasSession(fakeStore, 'user-id')).toBe(false);
	});

	it('createSessionWithPrekeyBundle handles bundle with preKeys', async () => {
		const builderProto = (await import('@privacyresearch/libsignal-protocol-typescript'))
			.SessionBuilder.prototype as unknown as {
			processPreKey: (...args: unknown[]) => Promise<void>;
		};
		const spy = vi.spyOn(builderProto, 'processPreKey').mockResolvedValue(undefined);

		const signed = { id: 1, publicKey: 'QQQ', signature: 'SSS' };
		const preKeys = [{ id: 10, publicKey: 'PKK' }];
		const payload = {
			bundle: {
				identityKey: 'AAA',
				registrationId: 2,
				signedPreKey: signed,
				preKeys
			}
		};

		const fakeStore = { asStorageType: () => ({}) } as unknown as Parameters<
			typeof createSessionWithPrekeyBundle
		>[0];
		await createSessionWithPrekeyBundle(fakeStore, payload);
		expect(spy).toHaveBeenCalled();
	});

	it('createSessionWithPrekeyBundle throws when malformed signedPreKey', async () => {
		const signed = { id: 'not-a-number', publicKey: 'QQQ', signature: 'SSS' };
		const payload = {
			bundle: { identityKey: 'AAA', registrationId: 2, signedPreKey: signed }
		};
		await expect(
			createSessionWithPrekeyBundle(
				{} as unknown as Parameters<typeof createSessionWithPrekeyBundle>[0],
				payload
			)
		).rejects.toThrow(TypeError);
	});

	it('createSessionWithPrekeyBundle handles processPreKey error', async () => {
		const builderProto = (await import('@privacyresearch/libsignal-protocol-typescript'))
			.SessionBuilder.prototype as unknown as {
			processPreKey: (...args: unknown[]) => Promise<void>;
		};
		vi.spyOn(builderProto, 'processPreKey').mockRejectedValue(new Error('ProcessPreKey failed'));

		const signed = { id: 1, publicKey: 'QQQ', signature: 'SSS' };
		const payload = { bundle: { identityKey: 'AAA', registrationId: 2, signedPreKey: signed } };

		const fakeStore = { asStorageType: () => ({}) } as unknown as Parameters<
			typeof createSessionWithPrekeyBundle
		>[0];
		await expect(createSessionWithPrekeyBundle(fakeStore, payload)).rejects.toThrow(
			'ProcessPreKey failed'
		);
	});

	it('encryptMessage throws when no ciphertext body', async () => {
		const fakeStore = { asStorageType: () => ({}) } as unknown as Parameters<
			typeof encryptMessage
		>[0];
		const libc = await import('@privacyresearch/libsignal-protocol-typescript');
		(
			libc.SessionCipher.prototype as unknown as {
				encrypt?: (...args: unknown[]) => Promise<unknown>;
			}
		).encrypt = vi.fn().mockResolvedValue({ type: 1, body: null });

		await expect(encryptMessage(fakeStore, 'user-x', 'hello')).rejects.toThrow(
			'Signal encryption produced no ciphertext body'
		);
	});

	it('encryptMessage handles binary string body', async () => {
		const fakeStore = { asStorageType: () => ({}) } as unknown as Parameters<
			typeof encryptMessage
		>[0];
		const libc = await import('@privacyresearch/libsignal-protocol-typescript');
		(
			libc.SessionCipher.prototype as unknown as {
				encrypt?: (...args: unknown[]) => Promise<unknown>;
			}
		).encrypt = vi.fn().mockResolvedValue({ type: 1, body: '\x00\x01\x02\x03' });

		const result = await encryptMessage(fakeStore, 'user-x', 'hello');
		expect(result.body).toBeDefined();
		expect(typeof result.body).toBe('string');
	});

	it('encryptMessage throws on unexpected body type', async () => {
		const fakeStore = { asStorageType: () => ({}) } as unknown as Parameters<
			typeof encryptMessage
		>[0];
		const libc = await import('@privacyresearch/libsignal-protocol-typescript');
		(
			libc.SessionCipher.prototype as unknown as {
				encrypt?: (...args: unknown[]) => Promise<unknown>;
			}
		).encrypt = vi.fn().mockResolvedValue({ type: 1, body: 12345 });

		await expect(encryptMessage(fakeStore, 'user-x', 'hello')).rejects.toThrow(
			'Unexpected ciphertext body type'
		);
	});

	it('decryptMessage handles decryption error and logs details', async () => {
		const fakeStore = {
			asStorageType: () => ({}),
			loadSession: async () => null,
			getIdentityKeyPair: async () => ({
				pubKey: new ArrayBuffer(32),
				privKey: new ArrayBuffer(32)
			}),
			loadSignedPreKey: async () => ({
				keyId: 1,
				keyPair: { pubKey: new ArrayBuffer(32), privKey: new ArrayBuffer(32) }
			})
		} as unknown as Parameters<typeof decryptMessage>[0];

		const libc = await import('@privacyresearch/libsignal-protocol-typescript');
		(
			libc.SessionCipher.prototype as unknown as {
				decryptPreKeyWhisperMessage?: (...args: unknown[]) => Promise<unknown>;
			}
		).decryptPreKeyWhisperMessage = vi.fn().mockRejectedValue(new Error('Decryption failed'));

		const encStr = 'QUJD';
		// SignalDecryptionError wraps the original error with a user-friendly message
		await expect(decryptMessage(fakeStore, 'sender', encStr)).rejects.toThrow('Cannot decrypt');
	});
});
