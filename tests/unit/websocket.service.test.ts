import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EncryptedWireMessage } from '$lib/types';

vi.mock('$lib/services/dev-logger', () => ({
	logger: {
		error: vi.fn(),
		request: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	}
}));

// Mock socket.io-client's io factory
const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
const emitted: Array<{ event: string; payload?: unknown }> = [];

const fakeSocket: {
	connected: boolean;
	id: string;
	on: (event: string, cb: (...args: unknown[]) => void) => void;
	emit: (event: string, payload?: unknown, cb?: (...args: unknown[]) => void) => void;
	removeAllListeners: () => void;
	disconnect: () => void;
	timeout: (milliseconds: number) => { emitWithAck: typeof acknowledge };
} = {
	connected: true,
	id: 'socket-1',
	timeout: () => ({ emitWithAck: acknowledge }),
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
	disconnect(this: { connected: boolean }) {
		this.connected = false;
	}
};

const acknowledge = vi.fn(async (event: string, payload: EncryptedWireMessage) => {
	emitted.push({ event, payload });
	return { ok: true, id: payload._id };
});

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
			status: 'Seen',
			read: false,
			timestamp: new Date().toISOString()
		};
		const cbs = listeners.get('receiveMessage') || [];
		expect(cbs.length).toBeGreaterThan(0);
		// call the registered handler
		cbs.forEach((cb) => cb(payload));

		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ _id: 'm1', status: 'read', read: true })
		);
		unsub();
	});

	it('ignores malformed message frames', async () => {
		const handler = vi.fn();
		const unsubscribe = wsService.onMessage(handler);
		wsService.connect();
		const [receive] = listeners.get('receiveMessage') ?? [];
		const valid = { id: 'm1', senderId: 'u1', receiverId: 'u2', message: 'hi' };
		try {
			for (const payload of [
				valid,
				{ ...valid, status: 'unknown' },
				{ ...valid, status: 'Delivered', id: '' },
				{ ...valid, status: 'Delivered', senderId: {} },
				null
			]) {
				await receive(payload);
				expect(handler).not.toHaveBeenCalled();
			}
		} finally {
			unsubscribe();
		}
	});

	it('sends only an encrypted wire payload and requires a matching acknowledgement', async () => {
		wsService.connect();
		// service reports connected once connected
		expect(wsService.isConnected()).toBe(true);

		// connected -> emit
		const msg: EncryptedWireMessage = {
			_id: 'm1',
			senderId: 's1',
			receiverId: 'r1',
			clientMessageId: 'client-id',
			message: JSON.stringify({ __encrypted: true, type: 1, body: 'QUJD' })
		};
		// Send when connected should not log an error
		await wsService.sendMessage(msg);
		expect(logger.error).not.toHaveBeenCalled();

		// The fake socket collects emitted events in `emitted` — assert sendMessage was emitted
		const sendEmit = emitted.find((e) => e.event === 'sendMessage');
		expect(sendEmit).toBeTruthy();
		expect(sendEmit?.payload).toEqual(msg);
		acknowledge.mockResolvedValueOnce({ ok: true, id: 'wrong-message' });
		await expect(wsService.sendMessage(msg)).rejects.toThrow('acknowledgement');
		acknowledge.mockResolvedValueOnce({ ok: 'yes' as unknown as boolean, id: msg._id });
		await expect(wsService.sendMessage(msg)).rejects.toThrow('acknowledgement');
		await expect(wsService.sendMessage({ ...msg, message: 'plaintext' })).rejects.toThrow(
			'Encrypted envelope'
		);

		// simulate disconnected -> should log error
		fakeSocket.connected = false;
		await expect(wsService.sendMessage(msg)).rejects.toThrow('not connected');
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

	it('keeps mirrored typing for legacy subscribers and hides it from Go subscribers', () => {
		const legacy = vi.fn();
		const native = vi.fn();
		wsService.onTyping(legacy);
		wsService.onTyping(native, false);
		wsService.connect();

		wsService.sendTyping('peer', true, true);
		expect(emitted.find((event) => event.event === 'typing')?.payload).toEqual({
			receiverId: 'peer',
			isTyping: true,
			mirrored: true
		});
		for (const callback of listeners.get('typing') ?? []) {
			callback({ userId: 'sender', isTyping: true, mirrored: true });
			callback({ userId: 'sender', isTyping: false });
		}
		expect(legacy.mock.calls).toEqual([
			['sender', true],
			['sender', false]
		]);
		expect(native.mock.calls).toEqual([['sender', false]]);
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
