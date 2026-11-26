import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

// Mocks for many services used by chat page
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'http://localhost' } }));
vi.mock('$lib/config', () => ({
	API_BASE: 'http://localhost',
	LOGO_URL: 'https://example.com/logo.png',
	getOrCreateDeviceId: vi.fn().mockReturnValue('test-device-id')
}));

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
	mergeMessages: (_current: unknown[], updates: unknown[]) => updates,
	chatService: {
		flushNotifications: vi.fn().mockResolvedValue(undefined),
		getConversations: vi.fn().mockResolvedValue([]),
		getMessages: vi.fn().mockResolvedValue([]),
		getMessagesPage: vi.fn().mockResolvedValue({ messages: [], hasMore: false })
	}
}));
vi.mock('$lib/services/go-websocket', () => ({
	connectGoWebSocket: vi.fn(() => ({
		disconnect: vi.fn(),
		watchPresence: vi.fn(),
		sendTyping: vi.fn(),
		refreshPresence: vi.fn()
	}))
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
vi.mock('$lib/crypto/signal', () => ({
	hasLocalKeys: vi.fn().mockResolvedValue(true),
	initSignalWithRestore: vi.fn().mockResolvedValue(true),
	isSignalInitialized: vi.fn().mockReturnValue(false)
}));
vi.mock('$lib/crypto/keyEncryption', () => ({
	getCachedEncryptionPassword: vi.fn().mockReturnValue(null)
}));

import ChatPage from '../../../src/routes/chat/+page.svelte';

describe('chat page', () => {
	it('mounts and renders child components (ChatList)', async () => {
		render(ChatPage);
		const btn = await screen.findByRole('button', { name: /^New chat$/ });
		expect(btn).toBeTruthy();
	});

	it('connects to websocket on mount', async () => {
		render(ChatPage);
		const { connectGoWebSocket } = await import('$lib/services/go-websocket');
		// Wait for the async onMount to complete
		await waitFor(() => {
			expect(connectGoWebSocket).toHaveBeenCalledWith(
				'u1',
				expect.objectContaining({ onReady: expect.any(Function) })
			);
		});
	});

	it('shows connection progress and ignores catch-up from a closed socket', async () => {
		const { connectGoWebSocket } = await import('$lib/services/go-websocket');
		const { chatService } = await import('$lib/services/chat.service');
		vi.mocked(connectGoWebSocket).mockClear();
		render(ChatPage);
		const status = screen.getByRole('status', { name: 'Chat connection' });
		expect(status.textContent).toContain('Connecting');
		await waitFor(() => expect(connectGoWebSocket).toHaveBeenCalledTimes(1));
		const callbacks = vi.mocked(connectGoWebSocket).mock.calls[0][1];
		let finishCatchUp!: (conversations: []) => void;
		vi.mocked(chatService.getConversations).mockReturnValueOnce(
			new Promise((resolve) => {
				finishCatchUp = resolve;
			})
		);

		const firstCatchUp = callbacks.onReady();
		await waitFor(() => expect(status.textContent).toContain('Catching up'));
		callbacks.onDisconnect();
		finishCatchUp([]);
		await firstCatchUp;
		await waitFor(() => expect(status.textContent).toContain('Reconnecting'));
		callbacks.onReady();
		await waitFor(() => expect(status.textContent).toContain('Connected'));
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
