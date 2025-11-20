import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('$app/environment', () => ({ browser: true }));

// Mock store with unread notifications
vi.mock('$lib/stores/notification.store', () => ({
	notificationStore: {
		subscribe: (fn: (v: unknown) => void) => {
			fn({
				notifications: [
					{
						id: 'n1',
						_id: 'n1',
						title: 'T1',
						message: 'M1',
						type: 'message',
						read: false,
						createdAt: new Date().toISOString()
					},
					{
						id: 'n2',
						_id: 'n2',
						title: 'T2',
						message: 'M2',
						type: 'alert',
						read: true,
						createdAt: new Date().toISOString()
					}
				],
				unreadCount: 1,
				loading: false
			});
			return () => {};
		},
		markAsRead: vi.fn(),
		markAllAsRead: vi.fn(),
		delete: vi.fn()
	}
}));

import NotificationModal from '$lib/components/NotificationModal.svelte';

describe('NotificationModal unread UI and actions', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('displays unread count and mark-all button, clicking it calls store', async () => {
		const { notificationStore } = await import('$lib/stores/notification.store');
		const markAll = (notificationStore as any).markAllAsRead as ReturnType<typeof vi.fn>;

		const onClose = vi.fn();
		const { container } = render(NotificationModal, { isOpen: true, onClose });

		// Subtitle shows the count and label, but the DOM may split number and label into separate nodes.
		// Query the subtitle element directly by class and assert it contains both the numeric count and the word 'notification(s)'.
		const subtitle = container.querySelector('.modal-subtitle');
		expect(subtitle).toBeTruthy();
		const subtitleText = subtitle ? subtitle.textContent || '' : '';
		expect(/notifications?/i.test(subtitleText)).toBe(true);
		// Ensure the numeric count is present somewhere in the subtitle text
		expect(/\d+/.test(subtitleText)).toBe(true);

		const markAllBtn = screen.getByText('Mark all read');
		await fireEvent.click(markAllBtn);
		expect(markAll).toHaveBeenCalled();
	});
});
