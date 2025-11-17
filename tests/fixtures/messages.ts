/**
 * Message test fixtures
 */
import type { Message, ChatConversation } from '$lib/types';

export const testMessages: Message[] = [
	{
		_id: 'msg-1',
		senderId: 'user-bob-456',
		senderUsername: 'bob',
		receiverId: 'user-alice-123',
		content: 'Hello Alice!',
		timestamp: new Date().toISOString()
	},
	{
		_id: 'msg-2',
		senderId: 'user-alice-123',
		senderUsername: 'alice',
		receiverId: 'user-bob-456',
		content: 'Hi Bob!',
		timestamp: new Date().toISOString()
	}
];

export const testConversations: ChatConversation[] = [
	{
		userId: 'user-bob-456',
		username: 'bob',
		lastMessage: testMessages[0].content,
		lastMessageTime: testMessages[0].timestamp,
		unreadCount: 1
	},
	{
		userId: 'user-charlie-789',
		username: 'charlie',
		lastMessage: '',
		lastMessageTime: new Date().toISOString(),
		unreadCount: 0
	}
];
