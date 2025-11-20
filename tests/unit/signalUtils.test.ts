import { describe, it, expect } from 'vitest';

import {
	arrayBufferToBase64,
	base64ToArrayBuffer,
	arrayBufferEquals,
	toError
} from '$lib/crypto/signalUtils';

describe('signalUtils', () => {
	it('converts arrayBuffer to base64 and back', () => {
		const bytes = new Uint8Array([1, 2, 3, 255]);
		const buf = bytes.buffer;
		const b64 = arrayBufferToBase64(buf);
		const out = base64ToArrayBuffer(b64);
		expect(arrayBufferEquals(buf, out)).toBe(true);
	});

	it('arrayBufferEquals compares correctly', () => {
		const a = new Uint8Array([1, 2, 3]).buffer;
		const b = new Uint8Array([1, 2, 3]).buffer;
		const c = new Uint8Array([1, 2, 4]).buffer;
		expect(arrayBufferEquals(a, b)).toBe(true);
		expect(arrayBufferEquals(a, c)).toBe(false);
	});

	it('toError returns Error for different inputs', () => {
		const e1 = toError(new Error('boom'));
		expect(e1).toBeInstanceOf(Error);
		expect(e1.message).toBe('boom');

		const e2 = toError({ message: 'oops' });
		expect(e2.message).toBe('oops');

		const e3 = toError('plain');
		expect(e3).toBeInstanceOf(Error);
		expect(e3.message.length).toBeGreaterThan(0);
	});
});
