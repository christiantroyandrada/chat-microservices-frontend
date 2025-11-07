import { env } from '$env/dynamic/public';
import type { Message, WebSocketMessage } from '$lib/types';

type MessageCallback = (message: Message) => void;
type StatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void;
type TypingCallback = (userId: string, isTyping: boolean) => void;

class WebSocketService {
	private ws: WebSocket | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private reconnectDelay = 3000;
	private messageCallbacks: Set<MessageCallback> = new Set();
	private statusCallbacks: Set<StatusCallback> = new Set();
	private typingCallbacks: Set<TypingCallback> = new Set();
	private wsUrl: string;
	private token: string | null = null;
	private shouldReconnect = true;

	constructor(wsUrl?: string) {
		this.wsUrl = wsUrl || env.PUBLIC_WS_URL || 'ws://localhost:8082';
	}

	/**
	 * Connect to WebSocket server
	 */
	connect(token: string): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			console.log('WebSocket already connected');
			return;
		}

		this.token = token;
		this.shouldReconnect = true;

		try {
			// Include token in WebSocket URL as query parameter
			const url = `${this.wsUrl}?token=${encodeURIComponent(token)}`;
			this.ws = new WebSocket(url);

			this.ws.onopen = () => {
				console.log('WebSocket connected');
				this.reconnectAttempts = 0;
				this.notifyStatus('connected');
			};

			this.ws.onmessage = (event) => {
				try {
					const data: WebSocketMessage = JSON.parse(event.data);
					this.handleMessage(data);
				} catch (error) {
					console.error('Failed to parse WebSocket message:', error);
				}
			};

			this.ws.onerror = (error) => {
				console.error('WebSocket error:', error);
			};

			this.ws.onclose = () => {
				console.log('WebSocket disconnected');
				this.notifyStatus('disconnected');

				if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
					this.reconnect();
				}
			};
		} catch (error) {
			console.error('Failed to connect WebSocket:', error);
			this.reconnect();
		}
	}

	/**
	 * Disconnect from WebSocket server
	 */
	disconnect(): void {
		this.shouldReconnect = false;
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	/**
	 * Reconnect to WebSocket server
	 */
	private reconnect(): void {
		if (!this.token || !this.shouldReconnect) return;

		this.reconnectAttempts++;
		this.notifyStatus('reconnecting');

		console.log(
			`Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
		);

		setTimeout(() => {
			if (this.token) {
				this.connect(this.token);
			}
		}, this.reconnectDelay * this.reconnectAttempts);
	}

	/**
	 * Send a message through WebSocket
	 */
	sendMessage(message: Message): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(
				JSON.stringify({
					type: 'message',
					data: message
				})
			);
		} else {
			console.error('WebSocket is not connected');
		}
	}

	/**
	 * Send typing indicator
	 */
	sendTyping(receiverId: string, isTyping: boolean): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(
				JSON.stringify({
					type: 'typing',
					data: { receiverId, isTyping }
				})
			);
		}
	}

	/**
	 * Handle incoming WebSocket messages
	 */
	private handleMessage(data: WebSocketMessage): void {
		switch (data.type) {
			case 'message':
				if ('content' in data.data) {
					this.messageCallbacks.forEach((callback) => callback(data.data as Message));
				}
				break;

			case 'typing':
				if ('userId' in data.data) {
					const typingData = data.data as { userId: string; isTyping?: boolean };
					this.typingCallbacks.forEach((callback) =>
						callback(typingData.userId, typingData.isTyping || false)
					);
				}
				break;

			case 'online':
			case 'offline':
				// Handle user online/offline status
				console.log(`User ${data.type}:`, data.data);
				break;

			default:
				console.log('Unknown WebSocket message type:', data.type);
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
	 * Get current connection status
	 */
	get isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}
}

// Export singleton instance
export const wsService = new WebSocketService();
