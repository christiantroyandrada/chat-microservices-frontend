/**
 * Basic smoke tests for components
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all dependencies
vi.mock('$lib/services/auth.service', () => ({
	authService: { getCurrentUser: vi.fn(), logout: vi.fn() }
}));

vi.mock('$lib/services/chat.service', () => ({
	chatService: {
		sendMessage: vi.fn(),
		getMessages: vi.fn().mockResolvedValue([]),
		getConversations: vi.fn().mockResolvedValue([])
	}
}));

vi.mock('$lib/services/notification.service', () => ({
	notificationService: {
		getNotifications: vi.fn().mockResolvedValue([]),
		getUnreadCount: vi.fn().mockResolvedValue(0)
	}
}));

vi.mock('$lib/services/websocket.service', () => ({
	websocketService: {
		connect: vi.fn(),
		disconnect: vi.fn(),
		sendMessage: vi.fn(),
		isConnected: false
	}
}));

vi.mock('$lib/stores/auth.store', () => ({
	authStore: {
		subscribe: vi.fn((fn) => {
			fn({ user: null, loading: false, error: null });
			return () => {};
		})
	},
	user: { subscribe: vi.fn() }
}));

vi.mock('$lib/stores/chat.store', () => ({
	chatStore: {
		subscribe: vi.fn((fn) => {
			fn({
				conversations: [],
				messages: {},
				selectedUserId: null,
				loading: { conversations: false, messages: false }
			});
			return () => {};
		}),
		loadConversations: vi.fn(),
		loadMessages: vi.fn()
	}
}));

vi.mock('$lib/stores/notification.store', () => ({
	notificationStore: {
		subscribe: vi.fn((fn) => {
			fn({ notifications: [], unreadCount: 0, loading: false });
			return () => {};
		}),
		fetch: vi.fn()
	}
}));

vi.mock('$lib/stores/toast.store', () => ({
	toastStore: {
		subscribe: vi.fn(),
		success: vi.fn(),
		error: vi.fn()
	}
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('$app/environment', () => ({
	browser: true
}));

const mockLogger = {
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn()
};

vi.mock('$lib/services/dev-logger', () => ({
	logger: mockLogger
}));

vi.mock('$lib/crypto/signal', () => ({
	encryptMessage: vi.fn().mockResolvedValue({ ciphertext: 'encrypted', type: 3 }),
	decryptMessage: vi.fn().mockResolvedValue('decrypted')
}));

describe('Component Imports', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should import ChatHeader component', async () => {
		const ChatHeader = await import('$lib/components/ChatHeader.svelte');
		expect(ChatHeader).toBeDefined();
		expect(ChatHeader.default).toBeDefined();
	});

	it('should import ChatList component', async () => {
		const ChatList = await import('$lib/components/ChatList.svelte');
		expect(ChatList).toBeDefined();
		expect(ChatList.default).toBeDefined();
	});

	it('should import MessageInput component', async () => {
		const MessageInput = await import('$lib/components/MessageInput.svelte');
		expect(MessageInput).toBeDefined();
		expect(MessageInput.default).toBeDefined();
	});

	it('should import MessageList component', async () => {
		const MessageList = await import('$lib/components/MessageList.svelte');
		expect(MessageList).toBeDefined();
		expect(MessageList.default).toBeDefined();
	});

	it('should import NotificationModal component', async () => {
		const NotificationModal = await import('$lib/components/NotificationModal.svelte');
		expect(NotificationModal).toBeDefined();
		expect(NotificationModal.default).toBeDefined();
	});
});
