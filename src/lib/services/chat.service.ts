import { apiClient } from './api';
import type { Message, SendMessagePayload, ChatConversation } from '$lib/types';

export const chatService = {
	/**
	 * Get all conversations for the current user
	 */
	async getConversations(): Promise<ChatConversation[]> {
		const response = await apiClient.get<ChatConversation[]>('/api/chat/conversations');
		return response.data || [];
	},

	/**
	 * Get messages between current user and another user
	 */
	async getMessages(userId: string, limit = 50, offset = 0): Promise<Message[]> {
		const response = await apiClient.get<Message[]>(
			`/api/chat/messages/${userId}?limit=${limit}&offset=${offset}`
		);
		return response.data || [];
	},

	/**
	 * Send a message to another user
	 */
	async sendMessage(payload: SendMessagePayload): Promise<Message> {
		const response = await apiClient.post<Message>('/api/chat/messages', payload);
		return response.data!;
	},

	/**
	 * Mark messages as read
	 */
	async markAsRead(senderId: string): Promise<void> {
		await apiClient.put(`/api/chat/messages/read/${senderId}`);
	},

	/**
	 * Delete a message
	 */
	async deleteMessage(messageId: string): Promise<void> {
		await apiClient.delete(`/api/chat/messages/${messageId}`);
	},

	/**
	 * Search users for starting new conversations
	 */
	async searchUsers(query: string): Promise<ChatConversation[]> {
		const response = await apiClient.get<ChatConversation[]>(
			`/api/user/search?q=${encodeURIComponent(query)}`
		);
		return response.data || [];
	}
};
