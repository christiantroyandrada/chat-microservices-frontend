import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

import MessageList from '$lib/components/MessageList.svelte';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/services/dev-logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

describe('MessageList typing autoscroll', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('scrolls to show typing bubble when shouldAutoScroll is true', async () => {
		const messages = [
			{
				_id: 'm1',
				senderId: 'a',
				receiverId: 'me',
				senderUsername: 'A',
				content: 'Hello',
				timestamp: new Date().toISOString()
			}
		];

		const { container, rerender } = render(MessageList, {
			messages,
			currentUserId: 'me',
			conversationId: 'c1',
			typingUsers: new Set()
		});
		const el = container.querySelector('.messages-container') as HTMLElement;
		if (!el) return;

		// Set shouldAutoScroll via simulating near-bottom
		Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
		Object.defineProperty(el, 'clientHeight', { value: 900, configurable: true });
		Object.defineProperty(el, 'scrollTop', { value: 100, configurable: true });

		const spy = vi.fn();
		el.scrollTo = spy;

		// Now set typingUsers to include conversationId to trigger typing effect
		await rerender({
			messages,
			currentUserId: 'me',
			conversationId: 'c1',
			typingUsers: new Set(['c1']),
			typingUsername: 'Alice'
		});

		// Expect scrollTo to have been called to reveal typing bubble
		expect(spy).toHaveBeenCalled();
	});
});
