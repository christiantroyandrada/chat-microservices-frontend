import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

vi.mock('$app/environment', () => ({ browser: true }));

// Mock notification store to return empty notifications
vi.mock('$lib/stores/notification.store', () => ({
	notificationStore: {
		subscribe: (fn: (v: unknown) => void) => {
			fn({ notifications: [], unreadCount: 0, loading: false });
			return () => {};
		},
		markAsRead: vi.fn(),
		markAllAsRead: vi.fn(),
		delete: vi.fn()
	}
}));

import NotificationModal from '$lib/components/NotificationModal.svelte';

describe('NotificationModal empty state UI', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('shows empty message and no mark-all button', () => {
		render(NotificationModal, { isOpen: true, onClose: () => {} });

		expect(screen.getByText('No notifications yet')).toBeTruthy();
		// Ensure the header close button (icon) is present
		expect(screen.getByLabelText('Close')).toBeTruthy();
		// There should be no 'Mark all read' button
		const markAll = screen.queryByText('Mark all read');
		expect(markAll).toBeNull();
	});
});
