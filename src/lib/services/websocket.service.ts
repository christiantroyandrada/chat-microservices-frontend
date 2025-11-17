import { env } from '$env/dynamic/public';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type {
	Message,
	MessageCallback,
	StatusCallback,
	TypingCallback,
	ReceiveMessagePayload,
	TypingPayload
} from '$lib/types';
import { logger } from './dev-logger';

class WebSocketService {
	private socket: Socket | null = null;
	private messageCallbacks: Set<MessageCallback> = new Set();
	private statusCallbacks: Set<StatusCallback> = new Set();
	private typingCallbacks: Set<TypingCallback> = new Set();
	private wsUrl: string;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(wsUrl?: string) {
		// Use PUBLIC_WS_URL from env or default to nginx gateway
		this.wsUrl = wsUrl || env.PUBLIC_WS_URL || 'http://localhost:85';
	}

	/**
	 * Connect to Socket.IO server
	 * Token is sent via httpOnly cookie, no need to pass it explicitly
	 */
	connect(): void {
		if (this.socket?.connected) {
			// already connected - nothing to do
			return;
		}

		try {
			// Connect to Socket.IO server with the /chat/socket.io path
			// Authentication is handled via httpOnly cookie sent with the request
			this.socket = io(this.wsUrl, {
				path: '/chat/socket.io',
				withCredentials: true, // Send cookies with requests
				transports: ['websocket', 'polling'],
				reconnection: true,
				reconnectionAttempts: 5,
				reconnectionDelay: 3000
			});

			this.socket.on('connect', () => {
				logger.info('[WebSocket] Connected to server, socket ID:', this.socket?.id || 'unknown');
				this.notifyStatus('connected');

				// Clear any pending reconnect timer
				if (this.reconnectTimer) {
					clearTimeout(this.reconnectTimer);
					this.reconnectTimer = null;
				}

				// JWT authentication happens on handshake (io.use middleware on server)
				// The server automatically joins the user to their room based on authenticated JWT
				// No need to emit 'identify' event anymore
			});
			this.socket.on('disconnect', () => {
				logger.info('[WebSocket] Disconnected from server');
				this.notifyStatus('disconnected');
			});
			this.socket.on('connect_error', (error) => {
				// Socket.IO may surface Error objects or plain strings; prefer a concise message
				const msg = error instanceof Error ? error.message : String(error);
				logger.warning('Socket.IO connection error:', msg);
			});

			this.socket.on('reconnect_attempt', () => {
				this.notifyStatus('reconnecting');
			});

			// Listen for incoming messages
			this.socket.on('receiveMessage', async (payload: unknown) => {
				const data = payload as ReceiveMessagePayload;

				// Normalize server message shape to frontend `Message`
				const normalized = {
					_id: String(data._id ?? data.id ?? ''),
					senderId: String(data.senderId ?? ''),
					senderUsername: String(data.senderUsername ?? data.senderName ?? '') || undefined,
					receiverId: String(data.receiverId ?? ''),
					content: String(data.content ?? data.message ?? ''),
					timestamp: String(data.timestamp ?? data.createdAt ?? new Date().toISOString()),
					read: Boolean(data.read ?? data.isRead ?? false),
					createdAt: data.createdAt as string | undefined,
					updatedAt: data.updatedAt as string | undefined
				} as Message;

				logger.request('[WebSocket] Received message:', {
					_id: normalized._id,
					senderId: normalized.senderId,
					receiverId: normalized.receiverId,
					contentLength: String(normalized.content?.length || 0)
				});

				// Pass message to callbacks (component will handle decryption with currentUserId)
				this.messageCallbacks.forEach((callback) => {
					try {
						callback(normalized);
					} catch (error) {
						logger.error('Error in message callback:', error);
					}
				});
			}); // Listen for typing indicators
			this.socket.on('typing', (payload: unknown) => {
				const d = payload as TypingPayload;
				this.typingCallbacks.forEach((callback) => {
					try {
						callback(String(d.userId ?? ''), Boolean(d.isTyping ?? false));
					} catch (error) {
						logger.error('Error in typing callback:', error);
					}
				});
			});
		} catch (error) {
			logger.error('Failed to connect Socket.IO:', error);
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
			// Authentication is handled via httpOnly cookie on the backend
			// No need to extract user ID from token client-side

			// Normalize message content (server expects `message` field)
			// Accept either `content` (frontend) or `message` (server) field
			const m = message as unknown as Record<string, unknown>;
			const msgContent = String(m.content ?? m.message ?? '');

			if (!msgContent || typeof msgContent !== 'string' || msgContent.trim().length === 0) {
				logger.error('Failed to send message: Invalid message content (empty or non-string)');
				return;
			}

			// Note: We don't validate if the message is encrypted here because:
			// 1. Messages are already encrypted and sent via REST API (chat service)
			// 2. WebSocket is used to broadcast the message for real-time delivery
			// 3. The sender's local copy has plaintext content for display

			this.socket.emit(
				'sendMessage',
				{
					_id: m._id || m.id, // Include message ID if it exists
					senderId: message.senderId, // Use senderId from message (or backend will set from JWT)
					receiverId: message.receiverId,
					message: msgContent
				},
				(response: { ok: boolean; id?: string; error?: string }) => {
					if (!response.ok) {
						logger.error('Failed to send message:', response.error);
					}
				}
			);
		} else {
			logger.error('Socket.IO is not connected');
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
				logger.error('Error in status callback:', error);
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
