import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateId } from '$lib/utils/generateId';

describe('generateId', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('uses crypto.randomUUID when available', () => {
		vi.stubGlobal('crypto', {
			randomUUID: () => 'my-uuid-123'
		});

		const id = generateId(7);
		expect(id).toContain('my-uuid-123');
		expect(id.endsWith('-7')).toBe(true);
	});

	it('uses crypto.getRandomValues when randomUUID not available', () => {
		vi.stubGlobal('crypto', {
			getRandomValues: (arr: Uint8Array) => {
				for (let i = 0; i < arr.length; i++) arr[i] = i + 1;
				return arr;
			}
		});

		const id = generateId(3);
		// bytes 1..8 -> hex 0102030405060708
		expect(id).toContain('0102030405060708');
		expect(id.endsWith('-3')).toBe(true);
	});

	it('keeps notification IDs distinct with no crypto and a frozen clock', () => {
		vi.stubGlobal('crypto', undefined);
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		vi.spyOn(Date, 'now').mockReturnValue(123);
		const first = generateId(2);
		const second = generateId(2);
		expect(first).not.toBe(second);
		expect(first.startsWith('123-')).toBe(true);
		expect(first.endsWith('-2')).toBe(true);
	});

	it('keeps notification IDs usable when crypto throws', () => {
		vi.stubGlobal('crypto', {
			randomUUID: () => {
				throw new Error('unavailable');
			}
		});
		const id = generateId(4);
		expect(id.endsWith('-4')).toBe(true);
	});
});
