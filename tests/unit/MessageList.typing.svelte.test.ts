import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

import MessageList from '$lib/components/MessageList.svelte';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/services/dev-logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

describe('MessageList typing bubble', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('shows typing bubble and typing label when typingUsers contains conversationId', () => {
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

		const typingUsers = new Set<string>(['c1']);

		render(MessageList, {
			messages,
			currentUserId: 'me',
			conversationId: 'c1',
			typingUsers,
			typingUsername: 'Alice'
		});

		// The sr-only label contains the readable typing text
		expect(screen.getByText(/Alice is typing|Someone is typing/)).toBeTruthy();
		// The compact typing bubble role should be present
		const bubble = document.querySelector('.typing-bubble');
		expect(bubble).toBeTruthy();
	});
});
