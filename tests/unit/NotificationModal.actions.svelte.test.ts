import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('$app/environment', () => ({ browser: true }));

// Provide a mocked notification store before importing the component
vi.mock('$lib/stores/notification.store', () => ({
	notificationStore: {
		subscribe: (
			fn: (v: {
				notifications: Array<Record<string, unknown>>;
				unreadCount: number;
				loading: boolean;
			}) => void
		) => {
			fn({
				notifications: [
					{
						id: 'n1',
						_id: 'n1',
						title: 'Hello',
						message: 'Body',
						type: 'message',
						read: false,
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

describe('NotificationModal actions', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('calls markAsRead and delete when action buttons clicked', async () => {
		const { notificationStore } = await import('$lib/stores/notification.store');
		const markAsRead = notificationStore.markAsRead as MockedFunction<
			typeof notificationStore.markAsRead
		>;
		const _del = notificationStore.delete as MockedFunction<typeof notificationStore.delete>;

		const onClose = vi.fn();
		const { container } = render(NotificationModal, { isOpen: true, onClose });

		// Mark as read button (title="Mark as read")
		const markBtn = container.querySelector('button[title="Mark as read"]') as HTMLElement;
		expect(markBtn).toBeTruthy();
		await fireEvent.click(markBtn);
		expect(markAsRead).toHaveBeenCalledWith('n1');

		// Delete button
		const delBtn = container.querySelector(
			'button[aria-label="Delete notification"]'
		) as HTMLElement;
		expect(delBtn).toBeTruthy();
		await fireEvent.click(delBtn);
		expect(_del).toHaveBeenCalledWith('n1');
	});
});
