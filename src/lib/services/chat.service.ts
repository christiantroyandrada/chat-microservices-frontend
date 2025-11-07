import { apiClient } from './api';
import type { Message, SendMessagePayload, ChatConversation } from '$lib/types';

// Shape of message object returned by the backend
interface ServerMessage {
	_id?: string;
	id?: string;
	senderId: string;
	senderUsername?: string;
	senderName?: string;
	receiverId: string;
	message?: string;
	content?: string;
	timestamp?: string;
	createdAt?: string;
	read?: boolean;
	isRead?: boolean;
	updatedAt?: string;
}

/**
 * Result type for better error handling
 */
export type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Helper to normalize server message shape -> frontend Message
 * Backend uses `message` field, frontend uses `content` field
 */
function normalizeMessage(serverMsg: ServerMessage): Message {
	return {
		_id: serverMsg._id || serverMsg.id || String(serverMsg._id || serverMsg.id || ''),
		senderId: serverMsg.senderId,
		senderUsername: serverMsg.senderUsername || serverMsg.senderName || undefined,
		receiverId: serverMsg.receiverId,
		// backend uses `message`; frontend uses `content`
		content: serverMsg.message ?? serverMsg.content ?? '',
		// prefer an explicit timestamp, fall back to createdAt
		timestamp: serverMsg.timestamp ?? serverMsg.createdAt ?? new Date().toISOString(),
		read: serverMsg.read ?? serverMsg.isRead ?? false,
		createdAt: serverMsg.createdAt,
		updatedAt: serverMsg.updatedAt,
	} as Message;
}

export const chatService = {
	/**
	 * Get all conversations for the current user
	 */
	async getConversations(): Promise<ChatConversation[]> {
		const response = await apiClient.get<ChatConversation[]>('/chat/conversations');
		return response.data || [];
	},

	/**
	 * Get messages between current user and another user
	 */
	async getMessages(userId: string, limit = 50, offset = 0): Promise<Message[]> {
		// backend exposes GET /get/:receiverId on the chat router (mounted under /chat)
		const response = await apiClient.get<ServerMessage[]>(
			`/chat/get/${userId}?limit=${limit}&offset=${offset}`
		);
		const data = response.data || [];
		return data.map(normalizeMessage);
	},

	/**
	 * Send a message to another user
	 */
	async sendMessage(payload: SendMessagePayload): Promise<Message> {
		// Validate payload before sending
		if (!payload.receiverId || !payload.content) {
			throw new Error('Invalid message payload');
		}

		if (payload.content.length > 5000) {
			throw new Error('Message too long');
		}

		// backend exposes POST /send on the chat router
		// backend expects `message` field, not `content`
		const response = await apiClient.post<ServerMessage>('/chat/send', {
			receiverId: payload.receiverId,
			message: payload.content, // map content -> message for backend
		});

		if (!response.data) {
			throw new Error('Failed to send message');
		}

		return normalizeMessage(response.data);
	},

	/**
	 * Mark messages as read
	 */
	async markAsRead(senderId: string): Promise<void> {
		await apiClient.put(`/chat/messages/read/${senderId}`);
	},

	/**
	 * Delete a message
	 */
	async deleteMessage(messageId: string): Promise<void> {
		await apiClient.delete(`/chat/messages/${messageId}`);
	},

	/**
	 * Search users for starting new conversations
	 */
	async searchUsers(query: string): Promise<ChatConversation[]> {
		const response = await apiClient.get<ChatConversation[]>(
			`/user/search?q=${encodeURIComponent(query)}`
		);
		return response.data || [];
	}
};
