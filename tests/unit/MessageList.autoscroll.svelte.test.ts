import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

import MessageList from '$lib/components/MessageList.svelte';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/services/dev-logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

describe('MessageList autoscroll behavior', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('auto-scrolls when user is near bottom and does not when far', async () => {
		const today = new Date();
		const messages = [
			{
				_id: 'm1',
				senderId: 'a',
				receiverId: 'me',
				senderUsername: 'A',
				content: 'First',
				timestamp: today.toISOString()
			}
		];

		const { container, rerender } = render(MessageList, {
			messages,
			currentUserId: 'me',
			conversationId: 'c1'
		});
		const el = container.querySelector('.messages-container') as HTMLElement;

		// Simulate near-bottom: scrollHeight - scrollTop - clientHeight < 100
		if (el) {
			Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
			Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });
			// set scrollTop so difference is 50 (<100)
			Object.defineProperty(el, 'scrollTop', { value: 150, configurable: true });
			const spy = vi.fn();
			// @ts-ignore override
			el.scrollTo = spy;

			// Add a new message to trigger scroll behavior
			const newMessages = [
				...messages,
				{
					_id: 'm2',
					senderId: 'me',
					receiverId: 'a',
					senderUsername: 'Me',
					content: 'Second',
					timestamp: new Date().toISOString()
				}
			];
			await rerender({ messages: newMessages, currentUserId: 'me', conversationId: 'c1' });

			expect(spy).toHaveBeenCalled();

			// Now simulate far-from-bottom
			Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true });
			// Dispatch scroll event so the component updates shouldAutoScroll
			el.dispatchEvent(new Event('scroll'));
			const spy2 = vi.fn();
			// @ts-ignore
			el.scrollTo = spy2;

			const more = [
				...newMessages,
				{
					_id: 'm3',
					senderId: 'a',
					receiverId: 'me',
					senderUsername: 'A',
					content: 'Third',
					timestamp: new Date().toISOString()
				}
			];
			await rerender({ messages: more, currentUserId: 'me', conversationId: 'c1' });
			expect(spy2).not.toHaveBeenCalled();
		}
	});
});
