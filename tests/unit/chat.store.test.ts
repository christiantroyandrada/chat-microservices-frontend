/**
 * Unit tests for chat.store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Message } from '$lib/types';
import { get } from 'svelte/store';

// Mock dependencies
const mockChatService = {
	getConversations: vi.fn(),
	getMessages: vi.fn()
};

vi.mock('$lib/services/chat.service', () => ({
	chatService: mockChatService
}));

const mockLogger = {
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn()
};

vi.mock('$lib/services/dev-logger', () => ({
	logger: mockLogger
}));

describe('chatStore', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it('should initialize with empty state', async () => {
		const { chatStore } = await import('$lib/stores/chat.store');
		const state = get(chatStore);
		expect(state.conversations).toEqual([]);
		expect(state.messages).toEqual({});
		expect(state.selectedUserId).toBeNull();
	});

	it('should load conversations', async () => {
		const mockConversations = [
			{ userId: 'user1', username: 'User 1', lastMessage: 'Hello', unreadCount: 0 },
			{ userId: 'user2', username: 'User 2', lastMessage: 'Hi', unreadCount: 1 }
		];
		mockChatService.getConversations.mockResolvedValue(mockConversations);

		const { chatStore } = await import('$lib/stores/chat.store');
		await chatStore.loadConversations('currentUser');

		const state = get(chatStore);
		expect(state.conversations).toEqual(mockConversations);
		expect(state.loading.conversations).toBe(false);
	});

	it('should handle load conversations error', async () => {
		mockChatService.getConversations.mockRejectedValue(new Error('Network error'));

		const { chatStore } = await import('$lib/stores/chat.store');
		await chatStore.loadConversations('currentUser');

		const state = get(chatStore);
		expect(state.conversations).toEqual([]);
		expect(state.loading.conversations).toBe(false);
		expect(mockLogger.error).toHaveBeenCalled();
	});

	it('should load messages for a user', async () => {
		const mockMessages: Message[] = [
			{
				_id: '1',
				content: 'Hello',
				senderId: 'user1',
				receiverId: 'user2',
				timestamp: new Date().toISOString()
			},
			{
				_id: '2',
				content: 'Hi there',
				senderId: 'user2',
				receiverId: 'user1',
				timestamp: new Date().toISOString()
			}
		];
		mockChatService.getMessages.mockResolvedValue(mockMessages);

		const { chatStore } = await import('$lib/stores/chat.store');
		await chatStore.loadMessages('user1', 'user2');

		const state = get(chatStore);
		expect(state.messages['user1']).toEqual(mockMessages);
		expect(state.selectedUserId).toBe('user1');
		expect(state.loading.messages).toBe(false);
	});

	it('should add a message', async () => {
		const { chatStore } = await import('$lib/stores/chat.store');
		const newMessage: Message = {
			_id: '1',
			content: 'Test message',
			senderId: 'user1',
			receiverId: 'user2',
			timestamp: new Date().toISOString()
		};

		chatStore.addMessage('user1', newMessage);

		const state = get(chatStore);
		expect(state.messages['user1']).toContainEqual(newMessage);
	});

	it('should update conversation', async () => {
		const mockConversations = [
			{ userId: 'user1', username: 'User 1', lastMessage: 'Hello', unreadCount: 0 }
		];
		mockChatService.getConversations.mockResolvedValue(mockConversations);

		const { chatStore } = await import('$lib/stores/chat.store');
		await chatStore.loadConversations();

		chatStore.updateConversation('user1', { unreadCount: 5 });

		const state = get(chatStore);
		const conversation = state.conversations.find((c) => c.userId === 'user1');
		expect(conversation?.unreadCount).toBe(5);
	});

	it('should clear state', async () => {
		const { chatStore } = await import('$lib/stores/chat.store');

		// Add some data
		chatStore.addMessage('user1', {
			_id: '1',
			content: 'Test',
			senderId: 'user1',
			receiverId: 'user2',
			timestamp: new Date().toISOString()
		} as Message);

		// Clear
		chatStore.clear();

		const state = get(chatStore);
		expect(state.conversations).toEqual([]);
		expect(state.messages).toEqual({});
		expect(state.selectedUserId).toBeNull();
	});
});
