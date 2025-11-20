import { describe, it, expect, vi } from 'vitest';

describe('dev-logger modes', () => {
	it('emits structured logs in test/dev mode', async () => {
		vi.resetModules();
		// ensure env looks like test/dev
		process.env.NODE_ENV = 'test';
		process.env.VITEST = '1';

		const grp = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined as any);
		const clog = vi.spyOn(console, 'log').mockImplementation(() => undefined as any);
		const gend = vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined as any);

		const { logger } = await import('$lib/services/dev-logger');

		// Structured emit with object should group
		logger.requestor(['Req', 'extra'], { foo: 'bar' });
		expect(grp).toHaveBeenCalled();

		// Simple emit should call console.log
		logger.info('Info', { a: 1 });
		expect(clog).toHaveBeenCalled();

		grp.mockRestore();
		clog.mockRestore();
		gend.mockRestore();
	});

	it('is silent in production mode', async () => {
		vi.resetModules();
		process.env.NODE_ENV = 'production';
		delete process.env.VITEST;

		const clog = vi.spyOn(console, 'log').mockImplementation(() => undefined as any);

		const { logger } = await import('$lib/services/dev-logger');
		logger.info('should not log', { a: 1 });
		expect(clog).not.toHaveBeenCalled();

		clog.mockRestore();
	});
});
