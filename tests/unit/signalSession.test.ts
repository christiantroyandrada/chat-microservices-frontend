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
		async processPreKey(_device: any) {
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

function base64ToArrayBuffer(b64: string) {
	const bin = Buffer.from(b64, 'base64');
	return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
}

describe('signalSession', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('createSessionWithPrekeyBundle throws on missing fields', async () => {
		await expect(createSessionWithPrekeyBundle({} as any, {})).rejects.toThrow(TypeError);
	});

	it('createSessionWithPrekeyBundle throws when signedPreKey missing', async () => {
		const payload = { bundle: { identityKey: 'AAA', registrationId: 1 } };
		await expect(createSessionWithPrekeyBundle({} as any, payload)).rejects.toThrow(
			/signed prekey/
		);
	});

	it('createSessionWithPrekeyBundle calls processPreKey', async () => {
		const builderProto = (await import('@privacyresearch/libsignal-protocol-typescript'))
			.SessionBuilder.prototype as any;
		const spy = vi.spyOn(builderProto, 'processPreKey').mockResolvedValue(undefined);

		const signed = { id: 1, publicKey: 'QQQ', signature: 'SSS' };
		const payload = { bundle: { identityKey: 'AAA', registrationId: 2, signedPreKey: signed } };

		const fakeStore: any = { asStorageType: () => ({}) };
		await expect(createSessionWithPrekeyBundle(fakeStore, payload)).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
	});

	it('encryptMessage handles ArrayBuffer body', async () => {
		const fakeStore: any = { asStorageType: () => ({}) };
		// Spy on SessionCipher.encrypt to return ArrayBuffer body
		const cipherProto = (await import('@privacyresearch/libsignal-protocol-typescript'))
			.SessionCipher.prototype as any;
		vi.spyOn(cipherProto, 'encrypt').mockResolvedValue({
			type: 1,
			body: base64ToArrayBuffer('QUJD')
		});

		const result = await encryptMessage(fakeStore, 'user-x', 'hello');
		expect(result.type).toBe(1);
		expect(typeof result.body).toBe('string');
		expect(result.body.length).toBeGreaterThan(0);
	});

	it('encryptMessage handles string base64 body', async () => {
		const fakeStore: any = { asStorageType: () => ({}) };
		const cipherProto = (await import('@privacyresearch/libsignal-protocol-typescript'))
			.SessionCipher.prototype as any;
		vi.spyOn(cipherProto, 'encrypt').mockResolvedValue({ type: 1, body: 'AAAA' });

		const res = await encryptMessage(fakeStore, 'u', 'hi');
		expect(res.body).toBe('AAAA');
	});

	it('decryptMessage handles string (legacy) and object forms', async () => {
		const fakeStore: any = { asStorageType: () => ({}), loadSession: async () => undefined };

		// For PreKey (string) path
		const encStr = 'QUJD'; // base64 'ABC'
		const dec = await decryptMessage(fakeStore, 'sender', encStr);
		expect(dec).toBeDefined();

		// For object path (WhisperMessage)
		const obj = { type: 1, body: 'QUJD' } as any;
		const dec2 = await decryptMessage(fakeStore, 'sender', obj);
		expect(dec2).toBeDefined();
	});

	it('hasSession and removeSessionWith delegate to store', async () => {
		const fakeStore: any = {
			asStorageType: () => ({}),
			loadSession: async () => 'rec',
			removeAllSessions: vi.fn()
		};
		expect(await hasSession(fakeStore, 'u')).toBe(true);
		await removeSessionWith(fakeStore, 'u');
		expect(fakeStore.removeAllSessions).toHaveBeenCalledWith('u');
	});
});
