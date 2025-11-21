import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateId } from '$lib/utils/generateId';

type TestCrypto = {
	randomUUID?: () => string;
	getRandomValues?: (arr: Uint8Array) => Uint8Array;
};

describe('generateId', () => {
	// Narrowed view of globalThis for tests to avoid `any` casts
	const g = globalThis as unknown as { crypto?: TestCrypto };
	let originalCrypto: TestCrypto | undefined;
	let originalMathRandom: () => number;

	beforeEach(() => {
		originalCrypto = g.crypto;
		originalMathRandom = Math.random;
	});

	afterEach(() => {
		// restore
		g.crypto = originalCrypto;
		Math.random = originalMathRandom;
	});

	it('uses crypto.randomUUID when available', () => {
		g.crypto = {
			randomUUID: () => 'my-uuid-123'
		};

		const id = generateId(7);
		expect(id).toContain('my-uuid-123');
		expect(id.endsWith('-7')).toBe(true);
	});

	it('uses crypto.getRandomValues when randomUUID not available', () => {
		g.crypto = {
			getRandomValues: (arr: Uint8Array) => {
				for (let i = 0; i < arr.length; i++) arr[i] = i + 1;
				return arr;
			}
		};

		const id = generateId(3);
		// bytes 1..8 -> hex 0102030405060708
		expect(id).toContain('0102030405060708');
		expect(id.endsWith('-3')).toBe(true);
	});

	it('falls back to Math.random when no crypto', () => {
		g.crypto = undefined;
		Math.random = () => 0.123456;
		const id = generateId(2);
		expect(typeof id).toBe('string');
		expect(id).toContain('-');
		expect(id.endsWith('-2')).toBe(true);
	});
});
