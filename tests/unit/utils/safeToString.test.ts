import { describe, it, expect } from 'vitest';

import { safeToString } from '$lib/utils';

describe('safeToString', () => {
	it('returns fallback for null/undefined', () => {
		expect(safeToString(null, 'fb')).toBe('fb');
		expect(safeToString(undefined, 'fb2')).toBe('fb2');
	});

	it('handles primitives', () => {
		expect(safeToString('abc')).toBe('abc');
		expect(safeToString(123)).toBe('123');
		expect(safeToString(true)).toBe('true');
	});

	it('prefers common id-like fields on objects', () => {
		expect(safeToString({ id: 'xyz' })).toBe('xyz');
		expect(safeToString({ _id: 42 })).toBe('42');
	});

	it('uses custom toString when available and not default', () => {
		const o = {
			a: 1,
			toString() {
				return 'custom-string';
			}
		};
		expect(safeToString(o)).toBe('custom-string');
	});

	it('falls back when JSON stringify fails (circular)', () => {
		const a: Record<string, unknown> = {};
		(a as unknown as { self?: unknown }).self = a; // assign circular reference for test
		expect(safeToString(a, 'fallback')).toBe('fallback');
	});
});
