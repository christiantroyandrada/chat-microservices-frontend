import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// Hoist-safe mocks
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'http://localhost' } }));
vi.mock('$lib/services/dev-logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn(), debug: vi.fn() }
}));

// mock toastStore; we'll import it inside tests to inspect calls
vi.mock('$lib/stores/toast.store', () => ({
	toastStore: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}));

// auth store returns an authenticated user by default
vi.mock('$lib/stores/auth.store', () => ({
	authStore: {
		init: vi.fn(),
		subscribe: (fn: (v: { user: { _id: string } }) => void) => {
			fn({ user: { _id: 'me' } });
			return () => {};
		}
	},
	user: {
		subscribe: (fn: (v: { _id: string }) => void) => {
			fn({ _id: 'me' });
			return () => {};
		}
	}
}));

// wsService basic mock - inline factory (hoist-safe)
vi.mock('$lib/services/websocket.service', () => ({
	wsService: {
		connect: vi.fn(),
		disconnect: vi.fn(),
		isConnected: vi.fn().mockReturnValue(true),
		sendMessage: vi.fn(),
		sendTyping: vi.fn(),
		onMessage: vi.fn().mockReturnValue(() => {}),
		onTyping: vi.fn().mockReturnValue(() => {}),
		onStatusChange: vi.fn().mockReturnValue(() => {}),
		onPresence: vi.fn().mockReturnValue(() => {})
	}
}));

// mock chatService; per-test we'll import and adjust the mocked methods
vi.mock('$lib/services/chat.service', () => ({
	chatService: {
		getConversations: vi.fn().mockResolvedValue([]),
		getMessages: vi.fn().mockResolvedValue([]),
		searchUsers: vi.fn().mockResolvedValue([])
	}
}));

vi.mock('$lib/crypto/signal', () => ({ initSignalWithRestore: vi.fn().mockResolvedValue(true) }));

import ChatPage from '../../../src/routes/chat/+page.svelte';

describe('Chat route behaviors', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// reset default resolved values
		// reset mocks on chatService module
		(async () => {
			const mod = await import('$lib/services/chat.service');
			const getConversations = mod.chatService.getConversations as MockedFunction<
				typeof mod.chatService.getConversations
			>;
			const getMessages = mod.chatService.getMessages as MockedFunction<
				typeof mod.chatService.getMessages
			>;
			getConversations.mockResolvedValue([]);
			getMessages.mockResolvedValue([]);
		})();
	});

	it('shows toast error when initSignalWithRestore throws', async () => {
		// override signal init to reject
		const signal = await import('$lib/crypto/signal');
		const initSig = signal.initSignalWithRestore as MockedFunction<
			typeof signal.initSignalWithRestore
		>;
		initSig.mockRejectedValueOnce(new Error('boom'));

		render(ChatPage);
		const toast = await import('$lib/stores/toast.store');
		// toastStore.error should be called with message
		expect(toast.toastStore.error).toHaveBeenCalledWith('Failed to initialize encryption');
	});

	it('shows toast error when getConversations fails', async () => {
		const { chatService } = await import('$lib/services/chat.service');
		const getConversations = chatService.getConversations as MockedFunction<
			typeof chatService.getConversations
		>;
		getConversations.mockRejectedValueOnce(new Error('nope'));

		render(ChatPage);
		const toast = await import('$lib/stores/toast.store');
		expect(toast.toastStore.error).toHaveBeenCalled();
	});

	it('selecting a conversation calls getMessages and clears unread badge', async () => {
		const { chatService } = await import('$lib/services/chat.service');
		const conv = {
			userId: 'u42',
			username: 'Bob',
			unreadCount: 3,
			lastMessage: 'hey',
			lastMessageTime: new Date().toISOString()
		};
		const getConversationsOnce = chatService.getConversations as MockedFunction<
			typeof chatService.getConversations
		>;
		const getMessagesOnce = chatService.getMessages as MockedFunction<
			typeof chatService.getMessages
		>;
		getConversationsOnce.mockResolvedValueOnce([conv]);
		getMessagesOnce.mockResolvedValueOnce([
			{
				_id: 'm1',
				senderId: 'u42',
				receiverId: 'me',
				content: 'hey',
				timestamp: new Date().toISOString()
			}
		]);

		const { container } = render(ChatPage);

		// wait for conversations to load and badge to appear
		await waitFor(() => {
			expect(container.querySelector('.unread-badge')).toBeTruthy();
		});

		// click the conversation button to select
		const convBtn = container.querySelector('.conversation-button') as HTMLElement;
		await fireEvent.click(convBtn);

		// ensure getMessages was called for that user
		expect(chatService.getMessages).toHaveBeenCalled();

		// after selection unread badge should be cleared (no unread-badge elements)
		const badgeAfter = container.querySelector('.unread-badge');
		expect(badgeAfter).toBeNull();
	});
});
