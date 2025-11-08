import { apiClient } from './api';
import type { Message, SendMessagePayload, ChatConversation } from '$lib/types';

export const chatService = {
	/**
	 * Get all conversations for the current user
	 */
	async getConversations(): Promise<ChatConversation[]> {
		try {
			const response = await apiClient.get<ChatConversation[]>('/chat/conversations');
			return response.data || [];
		} catch (err) {
			// Backend doesn't expose a conversations list yet; return empty list instead of throwing.
			console.warn(
				'getConversations: returning empty list due to backend missing endpoint or error',
				err
			);
			return [];
		}
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
		// backend exposes POST /send on the chat router
		const response = await apiClient.post<Message>('/chat/send', payload);
		return response.data!;
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
