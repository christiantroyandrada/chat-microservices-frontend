import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

// Mocks for many services used by chat page
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'http://localhost' } }));

vi.mock('$lib/stores/auth.store', () => ({
	authStore: {
		init: vi.fn(),
		subscribe: (fn: (value: { user: { _id: string } }) => void) => {
			fn({ user: { _id: 'u1' } });
			return () => {};
		}
	},
	user: {
		subscribe: (fn: (value: { _id: string }) => void) => {
			fn({ _id: 'u1' });
			return () => {};
		}
	}
}));

vi.mock('$lib/services/chat.service', () => ({
	chatService: {
		getConversations: vi.fn().mockResolvedValue([]),
		getMessages: vi.fn().mockResolvedValue([])
	}
}));
vi.mock('$lib/services/websocket.service', () => ({
	wsService: {
		connect: vi.fn(),
		disconnect: vi.fn(),
		onMessage: vi.fn().mockReturnValue(() => {}),
		onTyping: vi.fn().mockReturnValue(() => {}),
		onStatusChange: vi.fn().mockReturnValue(() => {}),
		onPresence: vi.fn().mockReturnValue(() => {})
	}
}));
vi.mock('$lib/stores/notification.store', () => ({
	notificationStore: {
		fetch: vi.fn().mockResolvedValue([]),
		subscribe: (fn: (value: { notifications: unknown[] }) => void) => {
			fn({ notifications: [] });
			return () => {};
		}
	}
}));
vi.mock('$lib/crypto/signal', () => ({ initSignalWithRestore: vi.fn().mockResolvedValue(true) }));
vi.mock('$lib/crypto/keyEncryption', () => ({
	getCachedEncryptionPassword: vi.fn().mockReturnValue(null)
}));

import ChatPage from '../../../src/routes/chat/+page.svelte';

describe('chat page', () => {
	it('mounts and renders child components (ChatList)', async () => {
		render(ChatPage);
		// ChatList contains a button with aria-label 'Start new conversation'
		const btn = await screen.findByLabelText('Start new conversation');
		expect(btn).toBeTruthy();
	});

	it('connects to websocket on mount', async () => {
		render(ChatPage);
		const { wsService } = await import('$lib/services/websocket.service');
		// Wait for the async onMount to complete
		await waitFor(() => {
			expect(wsService.connect).toHaveBeenCalled();
		});
	});

	it('initializes Signal Protocol on mount', async () => {
		render(ChatPage);
		const { initSignalWithRestore } = await import('$lib/crypto/signal');
		expect(initSignalWithRestore).toHaveBeenCalled();
	});

	it('loads conversations on mount', async () => {
		render(ChatPage);
		const { chatService } = await import('$lib/services/chat.service');
		expect(chatService.getConversations).toHaveBeenCalled();
	});

	it('fetches notifications on mount', async () => {
		render(ChatPage);
		const { notificationStore } = await import('$lib/stores/notification.store');
		expect(notificationStore.fetch).toHaveBeenCalled();
	});
});
