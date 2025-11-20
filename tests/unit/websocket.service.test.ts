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
	} catch {
		// ignore
	}
});

afterEach(() => {
	try {
		wsService.disconnect();
	} catch {
		// ignore
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

		// The fake socket collects emitted events in `emitted` — assert sendMessage was emitted
		const sendEmit = emitted.find((e) => e.event === 'sendMessage');
		expect(sendEmit).toBeTruthy();

		// simulate disconnected -> should log error
		fakeSocket.connected = false;
		wsService.sendMessage(msg);
		expect(logger.error).toHaveBeenCalled();
	});

	it('sendTyping emits when connected and does nothing when disconnected', () => {
		wsService.connect();
		// send typing while connected
		wsService.sendTyping('r1', true);
		const typingEmit = emitted.find((e) => e.event === 'typing');
		expect(typingEmit).toBeTruthy();
		expect(typingEmit?.payload).toEqual({ receiverId: 'r1', isTyping: true });

		// simulate disconnected
		emitted.length = 0;
		fakeSocket.connected = false;
		wsService.sendTyping('r1', false);
		const typingEmit2 = emitted.find((e) => e.event === 'typing');
		expect(typingEmit2).toBeFalsy();
	});

	it('subscription callbacks for status, typing and presence are invoked by server events', () => {
		const statusCb = vi.fn();
		const typingCb = vi.fn();
		const presenceCb = vi.fn();

		const unsubStatus = wsService.onStatusChange(statusCb);
		const unsubTyping = wsService.onTyping(typingCb);
		const unsubPresence = wsService.onPresence(presenceCb);

		wsService.connect();

		// simulate server 'connect' event
		const connectCbs = listeners.get('connect') || [];
		connectCbs.forEach((cb) => cb());
		expect(statusCb).toHaveBeenCalledWith('connected');

		// simulate server 'typing' event
		const typingCbs = listeners.get('typing') || [];
		typingCbs.forEach((cb) => cb({ userId: 'u1', isTyping: true }));
		expect(typingCb).toHaveBeenCalledWith('u1', true);

		// simulate server 'presence' event
		const presenceCbs = listeners.get('presence') || [];
		const p = { userId: 'u2', online: false, lastSeen: new Date().toISOString() };
		presenceCbs.forEach((cb) => cb(p));
		expect(presenceCb).toHaveBeenCalled();

		// simulate server 'disconnect' event
		const disconnectCbs = listeners.get('disconnect') || [];
		disconnectCbs.forEach((cb) => cb());
		expect(statusCb).toHaveBeenCalledWith('disconnected');

		// cleanup
		unsubStatus();
		unsubTyping();
		unsubPresence();
	});

	it('disconnect clears socket listeners and marks service disconnected', () => {
		wsService.connect();
		const connectCbs = listeners.get('connect') || [];
		connectCbs.forEach((cb) => cb());
		expect(wsService.isConnected()).toBe(true);
		wsService.disconnect();
		expect(wsService.isConnected()).toBe(false);
		expect(listeners.size).toBe(0);
	});
});
