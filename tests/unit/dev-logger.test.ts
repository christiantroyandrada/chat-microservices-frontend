import { describe, it, expect, vi } from 'vitest';

// Ensure env signals development so logger emits
process.env.NODE_ENV = 'test';
process.env.VITEST = '1';

describe('dev-logger basic emit', () => {
	it('emits to console when in dev/test', async () => {
		const grp = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined as any);
		const clog = vi.spyOn(console, 'log').mockImplementation(() => undefined as any);

		// Import module after setting env
		const { logger } = await import('$lib/services/dev-logger');

		logger.info('test-info', { a: 1 });
		logger.debug('d', { b: 2 });

		expect(clog.mock.calls.length).toBeGreaterThanOrEqual(1);
		grp.mockRestore();
		clog.mockRestore();
	});
});
