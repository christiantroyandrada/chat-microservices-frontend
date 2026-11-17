import type { Message } from '$lib/types';
import { assertValidServerMessage, normalizeMessage } from './server-message';

export function connectGoWebSocket(
	owner: string,
	{
		onMessage,
		onReceipt,
		onReady,
		onTyping,
		onPresence
	}: {
		onMessage: (message: Message) => void;
		onReceipt: (peerId: string) => void;
		onReady: () => void;
		onTyping: (peerId: string, isTyping: boolean) => void;
		onPresence: (peerId: string, online: boolean | null) => void;
	}
) {
	const url = new URL('/ws/v1', window.location.href);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.searchParams.set('expectedUserId', owner);
	let socket: WebSocket;
	let reconnectTimer: ReturnType<typeof setTimeout>;
	let handshakeTimer: ReturnType<typeof setTimeout>;
	let delay = 1000;
	let stopped = false;
	let ready = false;
	let typingPeer: string | undefined;
	let lastTyping = 0;
	let watchedPeer: string | undefined;

	function sendWatch() {
		if (ready && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'watchPresence', userId: watchedPeer ?? '' }));
		}
	}

	function connect() {
		const connection = new WebSocket(url);
		socket = connection;
		ready = false;
		typingPeer = undefined;
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
				if (watchedPeer) sendWatch();
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
			if (frame.type === 'typing' && frame.data && typeof frame.data === 'object') {
				const { userId, isTyping } = frame.data as Record<string, unknown>;
				if (typeof userId === 'string' && userId !== owner && typeof isTyping === 'boolean') {
					onTyping(userId, isTyping);
				}
				return;
			}
			if (frame.type === 'presence' && frame.data && typeof frame.data === 'object') {
				const { userId, online } = frame.data as Record<string, unknown>;
				if (watchedPeer && userId === watchedPeer && typeof online === 'boolean') {
					onPresence(watchedPeer, online);
				}
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
			ready = false;
			if (watchedPeer) onPresence(watchedPeer, null);
			clearTimeout(handshakeTimer);
			reconnectTimer = setTimeout(connect, delay + Math.random() * 250);
			delay = Math.min(delay * 2, 15000);
		});
	}

	connect();
	return {
		watchPresence(peerId: string | undefined) {
			if (stopped || peerId === watchedPeer) return;
			watchedPeer = peerId;
			sendWatch();
		},
		sendTyping(receiverId: string, isTyping: boolean) {
			if (stopped || !ready || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 2048)
				return;
			const now = performance.now();
			if (
				isTyping ? typingPeer === receiverId && now - lastTyping < 500 : typingPeer !== receiverId
			)
				return;
			socket.send(JSON.stringify({ type: 'typing', receiverId, isTyping }));
			typingPeer = isTyping ? receiverId : undefined;
			lastTyping = now;
		},
		disconnect() {
			stopped = true;
			clearTimeout(handshakeTimer);
			clearTimeout(reconnectTimer);
			socket.close();
		}
	};
}
