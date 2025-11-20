import { it, expect, vi } from 'vitest';

// Test error branches in websocket.service by resetting module cache and mocking
// socket.io-client to throw or to provide a fake socket that emits connect_error.

it('logs an error when io() throws during connect', async () => {
	vi.resetModules();

	vi.doMock('socket.io-client', () => ({
		io: vi.fn(() => {
			throw new Error('boom');
		})
	}));

	const mockLogger = { error: vi.fn(), request: vi.fn(), info: vi.fn(), warning: vi.fn() };
	vi.doMock('$lib/services/dev-logger', () => ({ logger: mockLogger }));

	const { wsService } = await import('$lib/services/websocket.service');
	const { logger } = await import('$lib/services/dev-logger');

	// calling connect should catch the thrown error and log it
	wsService.connect();
	expect((logger as any).error).toHaveBeenCalled();
});

it('handles connect_error event by logging a warning', async () => {
	vi.resetModules();

	const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
	const fakeSocket = {
		connected: false,
		on(event: string, cb: (...args: unknown[]) => void) {
			const arr = listeners.get(event) || [];
			arr.push(cb);
			listeners.set(event, arr);
		},
		emit() {},
		removeAllListeners() {}
	} as any;

	vi.doMock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));
	const mockLogger = { error: vi.fn(), request: vi.fn(), info: vi.fn(), warning: vi.fn() };
	vi.doMock('$lib/services/dev-logger', () => ({ logger: mockLogger }));

	const { wsService } = await import('$lib/services/websocket.service');
	const { logger } = await import('$lib/services/dev-logger');

	wsService.connect();

	const cbs = listeners.get('connect_error') || [];
	// simulate server-side connection error
	cbs.forEach((cb) => cb(new Error('server-fail')));

	expect((logger as any).warning).toHaveBeenCalled();
});
