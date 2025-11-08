import { env } from '$env/dynamic/public';
import { io, Socket } from 'socket.io-client';
import type { Message } from '$lib/types';

type MessageCallback = (message: Message) => void;
type StatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void;
type TypingCallback = (userId: string, isTyping: boolean) => void;

class WebSocketService {
	private socket: Socket | null = null;
	private messageCallbacks: Set<MessageCallback> = new Set();
	private statusCallbacks: Set<StatusCallback> = new Set();
	private typingCallbacks: Set<TypingCallback> = new Set();
	private wsUrl: string;
	private token: string | null = null;

	constructor(wsUrl?: string) {
		// Use PUBLIC_WS_URL from env or default to nginx gateway
		this.wsUrl = wsUrl || env.PUBLIC_WS_URL || 'http://localhost:85';
	}

	/**
	 * Connect to Socket.IO server
	 */
	connect(token: string): void {
		if (this.socket?.connected) {
			console.log('Socket.IO already connected');
			return;
		}

		this.token = token;

		try {
			// Connect to Socket.IO server with the /chat/socket.io path
			this.socket = io(this.wsUrl, {
				path: '/chat/socket.io',
				auth: { token },
				transports: ['websocket', 'polling'],
				reconnection: true,
				reconnectionAttempts: 5,
				reconnectionDelay: 3000
			});

			this.socket.on('connect', () => {
				console.log('Socket.IO connected');
				this.notifyStatus('connected');

				// Identify user after connection
				if (this.token) {
					// Decode token to get user ID (basic JWT decode)
					try {
						const payload = JSON.parse(atob(this.token.split('.')[1]));
						this.socket?.emit('identify', payload.id);
					} catch (e) {
						console.error('Failed to decode token:', e);
					}
				}
			});

			this.socket.on('disconnect', () => {
				console.log('Socket.IO disconnected');
				this.notifyStatus('disconnected');
			});

			this.socket.on('connect_error', (error) => {
				console.error('Socket.IO connection error:', error);
			});

			this.socket.on('reconnect_attempt', () => {
				console.log('Socket.IO reconnecting...');
				this.notifyStatus('reconnecting');
			});

			// Listen for incoming messages
			this.socket.on('receiveMessage', (data: Message) => {
				this.messageCallbacks.forEach((callback) => callback(data));
			});

			// Listen for typing indicators
			this.socket.on('typing', (data: { userId: string; isTyping: boolean }) => {
				this.typingCallbacks.forEach((callback) => callback(data.userId, data.isTyping));
			});
		} catch (error) {
			console.error('Failed to connect Socket.IO:', error);
		}
	}

	/**
	 * Disconnect from Socket.IO server
	 */
	disconnect(): void {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
	}

	/**
	 * Send a message through Socket.IO
	 */
	sendMessage(message: Message): void {
		if (this.socket?.connected) {
			this.socket.emit(
				'sendMessage',
				{
					senderId: message.senderId,
					receiverId: message.receiverId,
					message: message.content
				},
				(response: { ok: boolean; id?: string; error?: string }) => {
					if (!response.ok) {
						console.error('Failed to send message:', response.error);
					}
				}
			);
		} else {
			console.error('Socket.IO is not connected');
		}
	}

	/**
	 * Send typing indicator
	 */
	sendTyping(receiverId: string, isTyping: boolean): void {
		if (this.socket?.connected) {
			this.socket.emit('typing', { receiverId, isTyping });
		}
	}

	/**
	 * Notify status change
	 */
	private notifyStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void {
		this.statusCallbacks.forEach((callback) => callback(status));
	}

	/**
	 * Subscribe to incoming messages
	 */
	onMessage(callback: MessageCallback): () => void {
		this.messageCallbacks.add(callback);
		return () => this.messageCallbacks.delete(callback);
	}

	/**
	 * Subscribe to connection status changes
	 */
	onStatusChange(callback: StatusCallback): () => void {
		this.statusCallbacks.add(callback);
		return () => this.statusCallbacks.delete(callback);
	}

	/**
	 * Subscribe to typing indicators
	 */
	onTyping(callback: TypingCallback): () => void {
		this.typingCallbacks.add(callback);
		return () => this.typingCallbacks.delete(callback);
	}

	/**
	 * Get connection status
	 */
	isConnected(): boolean {
		return this.socket?.connected || false;
	}
}

export const wsService = new WebSocketService();
