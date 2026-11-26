import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectGoWebSocket } from '$lib/services/go-websocket';

class FixtureSocket extends EventTarget {
	static OPEN = 1;
	static instances: FixtureSocket[] = [];
	readyState = 1;
	bufferedAmount = 0;
	sent: string[] = [];
	constructor(readonly url: URL) {
		super();
		FixtureSocket.instances.push(this);
	}
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.dispatchEvent(new Event('close'));
	}
	frame(data: unknown) {
		this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
	}
}

const connections: ReturnType<typeof connectGoWebSocket>[] = [];
function connect() {
	const callbacks = {
		onReady: vi.fn(),
		onDisconnect: vi.fn(),
		onMessage: vi.fn(),
		onReceipt: vi.fn(),
		onPresence: vi.fn(),
		onTyping: vi.fn()
	};
	const client = connectGoWebSocket('alice', callbacks);
	connections.push(client);
	const socket = FixtureSocket.instances.at(-1)!;
	return { client, socket, ...callbacks };
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('WebSocket', FixtureSocket);
	vi.stubGlobal('window', { location: { href: 'https://chat.example/chat' } });
	vi.spyOn(Math, 'random').mockReturnValue(0);
	FixtureSocket.instances = [];
});
afterEach(() => {
	for (const client of connections.splice(0)) client.disconnect();
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Go WebSocket boundary', () => {
	it('uses the same origin and binds the expected account to the upgrade', () => {
		expect(connect().socket.url.href).toBe('wss://chat.example/ws/v1?expectedUserId=alice');
		vi.stubGlobal('window', { location: { href: 'http://localhost:3000/chat' } });
		expect(connect().socket.url.href).toBe('ws://localhost:3000/ws/v1?expectedUserId=alice');
	});

	it('rejects malformed and unready frames and delivers only the owner message', () => {
		const { socket, onMessage, onReady, client } = connect();
		const message = {
			id: 'm1',
			senderId: 'bob',
			receiverId: 'alice',
			message: 'ciphertext',
			status: 'Delivered'
		};
		socket.frame({ type: 'message', data: message });
		for (const data of ['invalid JSON', 'null', '42', new ArrayBuffer(1)]) {
			socket.dispatchEvent(new MessageEvent('message', { data }));
		}
		expect(onMessage).not.toHaveBeenCalled();
		socket.frame({ type: 'ready' });
		socket.frame({ type: 'ready' });
		expect(onReady).toHaveBeenCalledTimes(1);
		socket.frame({ type: 'message', data: {} });
		socket.frame({ type: 'message', data: { ...message, receiverId: 'carol' } });
		socket.frame({ type: 'unknown' });
		socket.frame({ type: 'message', data: message });
		expect(onMessage).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ _id: 'm1', content: 'ciphertext', status: 'delivered' })
		);
		client.disconnect();
		socket.frame({ type: 'message', data: message });
		expect(onMessage).toHaveBeenCalledTimes(1);
	});

	it('accepts valid receipts for this owner and rejects unrelated and malformed receipts', () => {
		const { socket, onReceipt, onTyping } = connect();
		socket.frame({ type: 'ready' });
		for (const data of [
			{ userId: 'carol', by: 'bob', type: 'read' },
			{ userId: 'alice', by: 'alice', type: 'read' },
			{ userId: 'alice', by: '', type: 'read' },
			{ userId: 'alice', by: 'bob', type: 'delivered' },
			{ userId: 'alice', by: 'bob', type: 'read', messageId: 'm1' },
			{ userId: 'alice', by: 'bob', type: 'invalid' },
			null
		])
			socket.frame({ type: 'receipt', data });
		expect(onReceipt).not.toHaveBeenCalled();
		socket.frame({
			type: 'receipt',
			data: { userId: 'alice', by: 'bob', type: 'delivered', messageId: 'm1' }
		});
		socket.frame({ type: 'receipt', data: { userId: 'alice', by: 'bob', type: 'read' } });
		expect(onReceipt.mock.calls).toEqual([['bob'], ['bob']]);
		socket.frame({ type: 'typing', data: { userId: 'alice', isTyping: true } });
		socket.frame({ type: 'typing', data: { userId: 'bob', isTyping: 'true' } });
		expect(onTyping).not.toHaveBeenCalled();
		socket.frame({ type: 'typing', data: { userId: 'bob', isTyping: true } });
		expect(onTyping).toHaveBeenCalledExactlyOnceWith('bob', true);
	});

	it('closes a stalled handshake and backs off reconnects without retaining old callbacks', () => {
		const { socket, client, onReady, onPresence, onDisconnect } = connect();
		client.watchPresence('bob');
		vi.advanceTimersByTime(5000);
		expect(socket.readyState).toBe(3);
		expect(onDisconnect).toHaveBeenCalledTimes(1);
		expect(onPresence).toHaveBeenCalledWith('bob', null);
		vi.advanceTimersByTime(1000);
		const second = FixtureSocket.instances[1];
		socket.frame({ type: 'ready' });
		expect(onReady).not.toHaveBeenCalled();
		second.frame({ type: 'ready' });
		expect(onReady).toHaveBeenCalledTimes(1);
		expect(second.sent).toEqual([JSON.stringify({ type: 'watchPresence', userId: 'bob' })]);
		second.close();
		vi.advanceTimersByTime(1000);
		const third = FixtureSocket.instances[2];
		third.close();
		vi.advanceTimersByTime(1999);
		expect(FixtureSocket.instances).toHaveLength(3);
		vi.advanceTimersByTime(1);
		expect(FixtureSocket.instances).toHaveLength(4);
		client.disconnect();
		expect(onDisconnect).toHaveBeenCalledTimes(3);
		client.watchPresence('carol');
		client.refreshPresence();
		expect(client.sendTyping('bob', true)).toBeUndefined();
		vi.advanceTimersByTime(60000);
		expect(FixtureSocket.instances).toHaveLength(4);
	});

	it('bounds presence refresh and typing to an open, ready connection', () => {
		const { socket, client, onPresence } = connect();
		expect(client.sendTyping('bob', true)).toBeUndefined();
		client.watchPresence('bob');
		socket.frame({ type: 'ready' });
		client.watchPresence('bob');
		client.refreshPresence();
		client.refreshPresence();
		expect(socket.sent).toHaveLength(2);
		socket.frame({ type: 'presence', data: { userId: 'carol', online: true } });
		socket.frame({ type: 'presence', data: { userId: 'bob', online: 'yes' } });
		expect(onPresence).not.toHaveBeenCalled();
		socket.frame({ type: 'presence', data: { userId: 'bob', online: true } });
		expect(onPresence).toHaveBeenCalledExactlyOnceWith('bob', true);
		expect(client.sendTyping('bob', false)).toBeUndefined();
		expect(client.sendTyping('bob', true)).toBe(true);
		expect(client.sendTyping('bob', true)).toBeUndefined();
		expect(client.sendTyping('bob', false)).toBe(true);
		socket.bufferedAmount = 2049;
		expect(client.sendTyping('bob', true)).toBeUndefined();
		socket.bufferedAmount = 0;
		socket.readyState = 0;
		expect(client.sendTyping('bob', true)).toBeUndefined();
		client.watchPresence(undefined);
	});
});
