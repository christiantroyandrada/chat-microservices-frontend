import { apiClient } from './api';
import type { Message, SendMessagePayload, ChatConversation } from '$lib/types';

/**
 * Result type for better error handling
 */
export type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

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
		const response = await apiClient.get<Message[]>(
			`/chat/get/${userId}?limit=${limit}&offset=${offset}`
		);
		return response.data || [];
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
		const response = await apiClient.post<Message>('/chat/send', payload);

		if (!response.data) {
			throw new Error('Failed to send message');
		}

		return response.data;
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
