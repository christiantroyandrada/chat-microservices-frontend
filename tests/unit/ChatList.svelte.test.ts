import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

import ChatList from '$lib/components/ChatList.svelte';

vi.mock('$app/environment', () => ({ browser: true }));

// Keep toast and services mocked similarly to other tests
vi.mock('$lib/stores/toast.store', () => ({
	toastStore: { subscribe: vi.fn(), error: vi.fn(), success: vi.fn(), clear: vi.fn() }
}));

vi.mock('$lib/services/chat.service', () => ({
	chatService: { searchUsers: vi.fn().mockResolvedValue([]) }
}));

// Mock dev logger so module resolution doesn't read `process.env` in browser tests
vi.mock('$lib/services/dev-logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

describe('ChatList component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('renders conversation items and shows unread badge (including 9+)', async () => {
		const conversations = [
			{
				userId: 'u1',
				username: 'Alice',
				lastMessage: 'Hello',
				lastMessageTime: new Date(Date.now() - 5 * 60000).toISOString(),
				unreadCount: 2
			},
			{
				userId: 'u2',
				username: 'Bob',
				lastMessage: 'This is a very long message that should be truncated by the component',
				lastMessageTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
				unreadCount: 12
			}
		];

		const onSelect = vi.fn();
		const { container } = render(ChatList, { conversations, onSelect, currentUserId: 'me' });

		// Both usernames should be visible
		expect(screen.getByText('Alice')).toBeTruthy();
		expect(screen.getByText('Bob')).toBeTruthy();

		// Truncated message for Bob should be present (starts with the long text)
		expect(container.querySelector('.conversation-message')?.textContent).toBeTruthy();

		// Unread badges: first should show '2', second should show '9+'
		const badges = container.querySelectorAll('.unread-badge');
		expect(badges.length).toBe(2);
		expect(badges[0].textContent).toBe('2');
		expect(badges[1].textContent).toBe('9+');

		// Conversation time should show a relative time string (e.g., '5m ago' or '1h ago')
		const timeSpans = container.querySelectorAll('.conversation-time');
		expect(timeSpans.length).toBeGreaterThanOrEqual(1);
		expect(/m ago|h ago|d ago|Just now/.test(timeSpans[0].textContent || '')).toBe(true);

		// Click the first conversation button and ensure onSelect is called with the userId
		const firstBtn = container.querySelector('.conversation-button') as HTMLElement;
		await fireEvent.click(firstBtn);
		expect(onSelect).toHaveBeenCalledWith('u1');
	});
});
