import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/services/dev-logger', () => ({
	logger: {
		error: vi.fn(),
		request: vi.fn(),
		info: vi.fn()
	}
}));

import { debounce, throttle } from '$lib/utils/debounce';
import { logger } from '$lib/services/dev-logger';

describe('debounce & throttle edge cases', () => {
	it('throttle calls function at most once per limit', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const thr = throttle(fn, 100);

		thr('a');
		thr('b');
		// Only first call should execute immediately
		expect(fn).toHaveBeenCalledTimes(1);

		// Advance past throttle limit and call again
		vi.advanceTimersByTime(150);
		thr('c');
		expect(fn).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it('debounce swallows exceptions and logs error', () => {
		vi.useFakeTimers();
		const fn = () => {
			throw new Error('boom');
		};
		const deb = debounce(fn as any, 10);
		deb();
		// advance to trigger
		vi.advanceTimersByTime(20);
		expect(logger.error).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('throttle logs errors thrown by wrapped function', () => {
		const fn = () => {
			throw new Error('throttle-boom');
		};
		const thr = throttle(fn as any, 10);
		thr();
		expect(logger.error).toHaveBeenCalled();
	});
});
