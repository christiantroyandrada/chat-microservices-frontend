import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/services/dev-logger', () => ({
	logger: {
		error: vi.fn(),
		request: vi.fn(),
		info: vi.fn()
	}
}));

// Mock socket.io-client's io factory
const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
const emitted: Array<{ event: string; payload?: unknown }> = [];

const fakeSocket: any = {
	connected: true,
	id: 'socket-1',
	on(event: string, cb: (...args: unknown[]) => void) {
		const arr = listeners.get(event) || [];
		arr.push(cb);
		listeners.set(event, arr);
	},
	emit(event: string, payload?: unknown, cb?: (...args: unknown[]) => void) {
		emitted.push({ event, payload });
		if (typeof cb === 'function') cb({ ok: true });
	},
	removeAllListeners() {
		listeners.clear();
	},
	disconnect() {
		this.connected = false;
	}
};

vi.mock('socket.io-client', () => ({
	io: vi.fn(() => fakeSocket)
}));

import { wsService } from '$lib/services/websocket.service';
import { logger } from '$lib/services/dev-logger';

beforeEach(() => {
	listeners.clear();
	emitted.length = 0;
	vi.clearAllMocks();
	// ensure mocked socket appears connected by default
	fakeSocket.connected = true;
	// ensure service is disconnected before each test
	try {
		wsService.disconnect();
	} catch (e) {
		void e;
	}
});

afterEach(() => {
	try {
		wsService.disconnect();
	} catch (e) {
		void e;
	}
});

describe('WebSocketService', () => {
	it('connect registers handlers and dispatches receiveMessage to subscribers', () => {
		const handler = vi.fn();
		const unsub = wsService.onMessage(handler);

		wsService.connect();

		// simulate incoming message
		const payload = {
			_id: 'm1',
			senderId: 'u1',
			senderUsername: 'bob',
			receiverId: 'u2',
			content: 'hi',
			timestamp: new Date().toISOString()
		};
		const cbs = listeners.get('receiveMessage') || [];
		expect(cbs.length).toBeGreaterThan(0);
		// call the registered handler
		cbs.forEach((cb) => cb(payload));

		expect(handler).toHaveBeenCalled();
		unsub();
	});

	it('sendMessage emits when connected and logs when not connected', () => {
		wsService.connect();
		// ensure socket was injected
		const internalSocket = (wsService as any).socket;
		expect(internalSocket).toBeDefined();
		expect(internalSocket).toBe(fakeSocket);

		// connected -> emit
		const msg = { _id: 'm1', senderId: 's1', receiverId: 'r1', content: 'hello' } as any;
		// Send when connected should not log an error
		wsService.sendMessage(msg);
		expect(logger.error).not.toHaveBeenCalled();

		// simulate disconnected -> should log error
		fakeSocket.connected = false;
		wsService.sendMessage(msg);
		expect(logger.error).toHaveBeenCalled();
	});
});
