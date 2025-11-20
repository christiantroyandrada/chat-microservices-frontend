import { describe, it, expect } from 'vitest';

import {
	arrayBufferToBase64,
	base64ToArrayBuffer,
	arrayBufferEquals,
	toError
} from '$lib/crypto/signalUtils';

describe('signalUtils', () => {
	it('converts ArrayBuffer <-> base64 and compares equality', () => {
		const bytes = new Uint8Array([1, 2, 3, 255]);
		const buf = bytes.buffer;

		const b64 = arrayBufferToBase64(buf);
		const back = base64ToArrayBuffer(b64);

		expect(arrayBufferEquals(buf, back)).toBe(true);
		// different length
		const other = new Uint8Array([1, 2, 3]).buffer;
		expect(arrayBufferEquals(buf, other)).toBe(false);
	});

	it('toError normalizes different inputs', () => {
		const err = new Error('boom');
		expect(toError(err)).toBe(err);

		const obj = { message: 'msg' } as unknown;
		const e2 = toError(obj);
		expect(e2).toBeInstanceOf(Error);
		expect(e2.message).toBe('msg');

		const e3 = toError('plain');
		expect(e3.message).toContain('plain');
	});
});
