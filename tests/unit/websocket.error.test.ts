import { it, expect, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

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
	const { logger } = (await import('$lib/services/dev-logger')) as {
		logger: { error: (...args: unknown[]) => void };
	};

	// calling connect should catch the thrown error and log it
	wsService.connect();
	expect(logger.error).toHaveBeenCalled();
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
	} as unknown as {
		connected: boolean;
		on: (event: string, cb: (...args: unknown[]) => void) => void;
		emit: (...args: unknown[]) => void;
		removeAllListeners: () => void;
	};

	vi.doMock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));
	const mockLogger = {
		error: vi.fn(),
		request: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	} as {
		error: MockedFunction<(...args: unknown[]) => void>;
		request: MockedFunction<(...args: unknown[]) => void>;
		info: MockedFunction<(...args: unknown[]) => void>;
		warning: MockedFunction<(...args: unknown[]) => void>;
	};
	vi.doMock('$lib/services/dev-logger', () => ({ logger: mockLogger }));

	const { wsService } = await import('$lib/services/websocket.service');
	const { logger } = (await import('$lib/services/dev-logger')) as {
		logger: { warning: (...args: unknown[]) => void };
	};

	wsService.connect();

	const cbs = listeners.get('connect_error') || [];
	// simulate server-side connection error
	cbs.forEach((cb) => cb(new Error('server-fail')));

	expect(logger.warning).toHaveBeenCalled();
});
