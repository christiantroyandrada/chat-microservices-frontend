import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

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

import ChatPage from '../../../src/routes/chat/+page.svelte';

describe('chat page', () => {
	it('mounts and renders child components (ChatList)', async () => {
		render(ChatPage);
		// ChatList contains a button with aria-label 'Start new conversation'
		const btn = await screen.findByLabelText('Start new conversation');
		expect(btn).toBeTruthy();
	});
});
