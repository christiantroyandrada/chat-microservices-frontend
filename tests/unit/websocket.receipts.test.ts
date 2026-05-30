import { it, expect, vi } from 'vitest';

// Verifies the read-receipt wiring added to websocket.service: inbound
// messageDelivered/messageRead events are forwarded to onReceipt subscribers,
// and sendDelivered/sendMarkRead emit the right socket events.
function setup() {
	const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
	const emit = vi.fn();
	const fakeSocket = {
		connected: true,
		on(event: string, cb: (...args: unknown[]) => void) {
			const arr = listeners.get(event) || [];
			arr.push(cb);
			listeners.set(event, arr);
		},
		emit,
		removeAllListeners() {}
	};
	const trigger = (event: string, payload: unknown) =>
		(listeners.get(event) || []).forEach((cb) => cb(payload));
	return { listeners, emit, fakeSocket, trigger };
}

it('forwards messageDelivered and messageRead to onReceipt subscribers', async () => {
	vi.resetModules();
	const { fakeSocket, trigger } = setup();
	vi.doMock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));
	vi.doMock('$lib/services/dev-logger', () => ({
		logger: { error: vi.fn(), request: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() }
	}));

	const { wsService } = await import('$lib/services/websocket.service');
	wsService.connect();

	const received: Array<{ type: string; messageId?: string; by: string }> = [];
	const unsub = wsService.onReceipt((e) => received.push(e));

	trigger('messageDelivered', { messageId: 'm1', by: 'bob' });
	trigger('messageRead', { by: 'bob' });

	expect(received).toEqual([
		{ type: 'delivered', messageId: 'm1', by: 'bob' },
		{ type: 'read', by: 'bob' }
	]);

	unsub();
	trigger('messageDelivered', { messageId: 'm2', by: 'bob' });
	expect(received).toHaveLength(2); // no longer subscribed
});

it('emits messageDelivered and markRead with the correct payloads', async () => {
	vi.resetModules();
	const { emit, fakeSocket } = setup();
	vi.doMock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));
	vi.doMock('$lib/services/dev-logger', () => ({
		logger: { error: vi.fn(), request: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() }
	}));

	const { wsService } = await import('$lib/services/websocket.service');
	wsService.connect();

	wsService.sendDelivered('m1');
	wsService.sendMarkRead('alice');

	expect(emit).toHaveBeenCalledWith('messageDelivered', { messageId: 'm1' });
	expect(emit).toHaveBeenCalledWith('markRead', { senderId: 'alice' });
});
