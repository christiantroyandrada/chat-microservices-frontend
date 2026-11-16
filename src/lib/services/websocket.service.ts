import { env } from '$env/dynamic/public';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type {
	Message,
	EncryptedWireMessage,
	MessageCallback,
	StatusCallback,
	TypingCallback,
	PresenceCallback,
	ReceiptCallback,
	ReceiptEvent,
	TypingPayload
} from '$lib/types';
import { logger } from './dev-logger';
import { assertValidServerMessage, normalizeMessage } from './server-message';
import { safeToString } from '$lib/utils';

class WebSocketService {
	private socket: Socket | null = null;
	private readonly messageCallbacks: Set<MessageCallback> = new Set();
	private readonly statusCallbacks: Set<StatusCallback> = new Set();
	private readonly typingCallbacks: Set<TypingCallback> = new Set();
	private readonly presenceCallbacks: Set<PresenceCallback> = new Set();
	private readonly receiptCallbacks: Set<ReceiptCallback> = new Set();
	private readonly wsUrl: string;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly safeToString: typeof safeToString;

	constructor(wsUrl?: string) {
		// Use PUBLIC_WS_URL from env or default to nginx gateway
		this.wsUrl = wsUrl || env.PUBLIC_WS_URL || 'http://localhost:80';
		// Bind utility here rather than at field-initializer time
		this.safeToString = safeToString;
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
			this.socket.on('receiveMessage', (payload: unknown) => {
				let normalized: Message;
				try {
					assertValidServerMessage(payload, 'socket.receiveMessage');
					normalized = normalizeMessage(payload);
				} catch {
					logger.warning('[WebSocket] Ignored malformed message');
					return;
				}

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

			// Listen for delivery/read receipts on our own sent messages
			this.socket.on('messageDelivered', (payload: unknown) => {
				const d = payload as { messageId?: string; by?: string };
				this.notifyReceipt({
					type: 'delivered',
					messageId: this.safeToString(d.messageId),
					by: this.safeToString(d.by)
				});
			});
			this.socket.on('messageRead', (payload: unknown) => {
				const d = payload as { by?: string };
				this.notifyReceipt({ type: 'read', by: this.safeToString(d.by) });
			});

			// Listen for presence updates (online/offline)
			this.socket.on('presence', (payload: unknown) => {
				const d = payload as { userId?: string; online?: boolean; lastSeen?: string };
				const userId = String(d.userId ?? '');
				const online = Boolean(d.online ?? false);
				const lastSeen = d.lastSeen ? String(d.lastSeen) : undefined;

				logger.request('[WebSocket] Presence update received:', {
					userId,
					online,
					lastSeen,
					rawPayload: payload
				});

				this.presenceCallbacks.forEach((callback) => {
					try {
						callback(userId, online, lastSeen);
					} catch (error) {
						logger.error('Error in presence callback:', error);
					}
				});
			});

			// Listen for bulk initial presence (single payload instead of O(n) individual emits)
			this.socket.on('presenceBulk', (payload: unknown) => {
				const d = payload as { onlineUserIds?: string[] };
				const ids = Array.isArray(d.onlineUserIds) ? d.onlineUserIds : [];

				logger.request('[WebSocket] Bulk presence received, online users:', String(ids.length));

				for (const uid of ids) {
					const userId = String(uid);
					this.presenceCallbacks.forEach((callback) => {
						try {
							callback(userId, true, undefined);
						} catch (error) {
							logger.error('Error in bulk presence callback:', error);
						}
					});
				}
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
		this.presenceCallbacks.clear();
		this.receiptCallbacks.clear();
	}

	/**
	 * Send a message through Socket.IO
	 */
	async sendMessage(message: EncryptedWireMessage): Promise<void> {
		const socket = this.socket;
		if (!socket?.connected) throw new Error('Socket.IO is not connected');
		let envelope: { __encrypted?: boolean; type?: number; body?: string };
		try {
			envelope = JSON.parse(message.message);
		} catch {
			throw new Error('Encrypted envelope is required');
		}
		if (
			!message._id ||
			!message.clientMessageId ||
			envelope.__encrypted !== true ||
			typeof envelope.type !== 'number' ||
			typeof envelope.body !== 'string' ||
			!envelope.body ||
			message.message.length > 5000
		)
			throw new Error('Encrypted envelope is required');
		const response = (await socket.timeout(5000).emitWithAck('sendMessage', message)) as {
			ok?: boolean;
			id?: string;
		};
		if (response?.ok !== true || response.id !== message._id)
			throw new Error('Message acknowledgement did not match');
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
	 * Tell the server we received a message (marks it Delivered and notifies
	 * the original sender). Called by the recipient on incoming messages.
	 */
	sendDelivered(messageId: string): void {
		if (this.socket?.connected && messageId) {
			this.socket.emit('messageDelivered', { messageId });
		}
	}

	/**
	 * Mark all messages from `senderId` to us as read and notify that sender.
	 * Called when the recipient opens/views the conversation.
	 */
	sendMarkRead(senderId: string): void {
		if (this.socket?.connected && senderId) {
			this.socket.emit('markRead', { senderId });
		}
	}

	private notifyReceipt(event: ReceiptEvent): void {
		this.receiptCallbacks.forEach((callback) => {
			try {
				callback(event);
			} catch (error) {
				logger.error('Error in receipt callback:', error);
			}
		});
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
	 * Subscribe to presence updates (online/offline status)
	 * Returns unsubscribe function that MUST be called to prevent memory leaks
	 */
	onPresence(callback: PresenceCallback): () => void {
		this.presenceCallbacks.add(callback);
		return () => {
			this.presenceCallbacks.delete(callback);
		};
	}

	/**
	 * Subscribe to delivery/read receipts for our own sent messages.
	 * Returns unsubscribe function that MUST be called to prevent memory leaks.
	 */
	onReceipt(callback: ReceiptCallback): () => void {
		this.receiptCallbacks.add(callback);
		return () => {
			this.receiptCallbacks.delete(callback);
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
