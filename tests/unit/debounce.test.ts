import { describe, it, expect, vi } from 'vitest';

import { debounce } from '$lib/utils/debounce';

describe('debounce util', () => {
	it('debounces repeated calls and eventually calls the function once', async () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const deb = debounce(fn, 100);

		// Call multiple times quickly
		deb('a');
		deb('b');
		deb('c');

		// Not yet called
		expect(fn).not.toHaveBeenCalled();

		// Advance past delay
		vi.advanceTimersByTime(150);
		expect(fn).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});
});
