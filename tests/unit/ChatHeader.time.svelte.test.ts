import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

import ChatHeader from '$lib/components/ChatHeader.svelte';

vi.mock('$app/environment', () => ({ browser: true }));

describe('ChatHeader time fallback', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('shows Online when lastMessageTime is very recent and online is undefined', () => {
		const now = new Date().toISOString();
		render(ChatHeader, { recipient: { userId: 'u1', username: 'Zed', lastMessageTime: now } });
		expect(screen.getByText('Online')).toBeTruthy();
	});

	it('shows relative Active Xm ago when lastMessageTime is older', () => {
		const tenMin = new Date(Date.now() - 10 * 60000).toISOString();
		render(ChatHeader, { recipient: { userId: 'u2', username: 'Y', lastMessageTime: tenMin } });
		expect(screen.getByText(/Active\s?10m ago|Active\s?\d+m ago/)).toBeTruthy();
	});
});
