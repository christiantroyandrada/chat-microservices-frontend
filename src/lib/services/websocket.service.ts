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
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(wsUrl?: string) {
		// Use PUBLIC_WS_URL from env or default to nginx gateway
		this.wsUrl = wsUrl || env.PUBLIC_WS_URL || 'http://localhost:85';
	}

	/**
	 * Connect to Socket.IO server
	 */
	connect(token: string): void {
		if (this.socket?.connected) {
			// already connected - nothing to do
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
			this.notifyStatus('connected');

			// Clear any pending reconnect timer
			if (this.reconnectTimer) {
				clearTimeout(this.reconnectTimer);
				this.reconnectTimer = null;
			}

			// JWT authentication happens on handshake (io.use middleware on server)
			// The server automatically joins the user to their room based on authenticated JWT
			// No need to emit 'identify' event anymore
		});			this.socket.on('disconnect', () => {
				this.notifyStatus('disconnected');
			});

			this.socket.on('connect_error', (error) => {
				console.error('Socket.IO connection error:', error);
			});

			this.socket.on('reconnect_attempt', () => {
				this.notifyStatus('reconnecting');
			});

			// Listen for incoming messages
			this.socket.on('receiveMessage', (data: any) => {
				// Normalize server message shape to frontend `Message`
				const normalized = {
					_id: data._id || data.id || String(data._id || data.id || ''),
					senderId: data.senderId,
					senderUsername: data.senderUsername || data.senderName || undefined,
					receiverId: data.receiverId,
					content: data.content ?? data.message ?? '',
					timestamp: data.timestamp ?? data.createdAt ?? new Date().toISOString(),
					read: data.read ?? data.isRead ?? false,
					createdAt: data.createdAt,
					updatedAt: data.updatedAt,
				} as Message;

				this.messageCallbacks.forEach((callback) => {
					try {
						callback(normalized);
					} catch (error) {
						console.error('Error in message callback:', error);
					}
				});
			});

			// Listen for typing indicators
			this.socket.on('typing', (data: { userId: string; isTyping: boolean }) => {
				this.typingCallbacks.forEach((callback) => {
					try {
						callback(data.userId, data.isTyping);
					} catch (error) {
						console.error('Error in typing callback:', error);
					}
				});
			});
		} catch (error) {
			console.error('Failed to connect Socket.IO:', error);
		}
	}

	/**
	 * Disconnect from Socket.IO server
	 */
	disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.socket) {
			// Remove all listeners before disconnecting
			this.socket.removeAllListeners();
			this.socket.disconnect();
			this.socket = null;
		}

		// Clear all callbacks
		this.messageCallbacks.clear();
		this.statusCallbacks.clear();
		this.typingCallbacks.clear();
	}

	/**
	 * Send a message through Socket.IO
	 */
	sendMessage(message: Message): void {
		if (this.socket?.connected) {
			// Extract authenticated user ID from token to ensure senderId matches JWT
			let authenticatedUserId: string | null = null;
			if (this.token) {
				try {
					const payload = JSON.parse(atob(this.token.split('.')[1]));
					authenticatedUserId = payload.id;
				} catch (e) {
					console.error('Failed to decode token:', e);
				}
			}

			// Normalize message content (server expects `message` field)
			// Accept either `content` (frontend) or `message` (server) field
			const msgContent = (message as any).content ?? (message as any).message ?? '';
			
			if (!msgContent || typeof msgContent !== 'string' || msgContent.trim().length === 0) {
				console.error('Failed to send message: Invalid message content (empty or non-string)');
				return;
			}

			this.socket.emit(
				'sendMessage',
				{
					senderId: authenticatedUserId || message.senderId,
					receiverId: message.receiverId,
					message: msgContent
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
		this.statusCallbacks.forEach((callback) => {
			try {
				callback(status);
			} catch (error) {
				console.error('Error in status callback:', error);
			}
		});
	}

	/**
	 * Subscribe to incoming messages
	 * Returns unsubscribe function that MUST be called to prevent memory leaks
	 */
	onMessage(callback: MessageCallback): () => void {
		this.messageCallbacks.add(callback);
		return () => {
			this.messageCallbacks.delete(callback);
		};
	}

	/**
	 * Subscribe to connection status changes
	 * Returns unsubscribe function that MUST be called to prevent memory leaks
	 */
	onStatusChange(callback: StatusCallback): () => void {
		this.statusCallbacks.add(callback);
		return () => {
			this.statusCallbacks.delete(callback);
		};
	}

	/**
	 * Subscribe to typing indicators
	 * Returns unsubscribe function that MUST be called to prevent memory leaks
	 */
	onTyping(callback: TypingCallback): () => void {
		this.typingCallbacks.add(callback);
		return () => {
			this.typingCallbacks.delete(callback);
		};
	}

	/**
	 * Get connection status
	 */
	isConnected(): boolean {
		return this.socket?.connected || false;
	}
}

export const wsService = new WebSocketService();
