import type { Message } from '$lib/types';
import { assertValidServerMessage, normalizeMessage } from './server-message';

export function connectGoWebSocket(
	owner: string,
	onMessage: (message: Message) => void,
	onReceipt: (peerId: string) => void,
	onReady: () => void
): () => void {
	const url = new URL('/ws/v1', window.location.href);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.searchParams.set('expectedUserId', owner);
	let socket: WebSocket;
	let reconnectTimer: ReturnType<typeof setTimeout>;
	let handshakeTimer: ReturnType<typeof setTimeout>;
	let delay = 1000;
	let stopped = false;

	function connect() {
		const connection = new WebSocket(url);
		socket = connection;
		let ready = false;
		handshakeTimer = setTimeout(() => connection.close(), 5000);
		connection.addEventListener('message', ({ data }) => {
			if (stopped || socket !== connection || typeof data !== 'string') return;
			let frame: { type?: unknown; data?: unknown };
			try {
				frame = JSON.parse(data);
				if (!frame || typeof frame !== 'object') return;
			} catch {
				return;
			}
			if (frame.type === 'ready' && !ready) {
				ready = true;
				delay = 1000;
				clearTimeout(handshakeTimer);
				onReady();
			}
			if (!ready) return;
			if (frame.type === 'receipt' && frame.data && typeof frame.data === 'object') {
				const { userId, by, type, messageId } = frame.data as Record<string, unknown>;
				if (
					userId === owner &&
					typeof by === 'string' &&
					by &&
					by !== owner &&
					((type === 'read' && messageId === undefined) ||
						(type === 'delivered' && typeof messageId === 'string' && messageId))
				)
					onReceipt(by);
				return;
			}
			if (frame.type !== 'message') return;
			try {
				assertValidServerMessage(frame.data, 'go-websocket.message');
			} catch {
				return;
			}
			if (frame.data.receiverId === owner) onMessage(normalizeMessage(frame.data));
		});
		connection.addEventListener('close', () => {
			if (stopped || socket !== connection) return;
			clearTimeout(handshakeTimer);
			reconnectTimer = setTimeout(connect, delay + Math.random() * 250);
			delay = Math.min(delay * 2, 15000);
		});
	}

	connect();
	return () => {
		stopped = true;
		clearTimeout(handshakeTimer);
		clearTimeout(reconnectTimer);
		socket.close();
	};
}
