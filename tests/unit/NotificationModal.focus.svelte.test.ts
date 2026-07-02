/**
 * Focus management tests for NotificationModal.
 *
 * aria-modal="true" promises focus containment: focus must move into the
 * dialog on open (so Escape works immediately), Tab must cycle inside it,
 * and focus must return to the opener on close.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import NotificationModal from '$lib/components/NotificationModal.svelte';

vi.mock('$lib/stores/notification.store', () => ({
	notificationStore: {
		subscribe: vi.fn((fn) => {
			fn({ notifications: [], unreadCount: 0, loading: false });
			return () => {};
		}),
		markAsRead: vi.fn(),
		markAllAsRead: vi.fn(),
		delete: vi.fn()
	}
}));

describe('NotificationModal focus management', () => {
	let opener: HTMLButtonElement;

	beforeEach(() => {
		vi.clearAllMocks();
		opener = document.createElement('button');
		opener.textContent = 'opener';
		document.body.appendChild(opener);
	});

	afterEach(() => {
		opener.remove();
	});

	it('moves focus onto the dialog when opened', async () => {
		render(NotificationModal, { isOpen: true, onClose: vi.fn() });
		await tick();
		expect(document.activeElement?.getAttribute('role')).toBe('dialog');
	});

	it('closes on Escape pressed inside the dialog', async () => {
		const onClose = vi.fn();
		const { container } = render(NotificationModal, { isOpen: true, onClose });
		await tick();
		const backdrop = container.querySelector('[role="dialog"]') as HTMLElement;
		await fireEvent.keyDown(backdrop, { key: 'Escape' });
		expect(onClose).toHaveBeenCalled();
	});

	it('wraps Shift+Tab from the dialog itself to the last focusable control', async () => {
		const { container } = render(NotificationModal, { isOpen: true, onClose: vi.fn() });
		await tick();
		const backdrop = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(document.activeElement).toBe(backdrop);

		await fireEvent.keyDown(backdrop, { key: 'Tab', shiftKey: true });
		// Empty state has a single focusable control: the header close button
		expect((document.activeElement as HTMLElement)?.getAttribute('aria-label')).toBe('Close');
	});

	it('returns focus to the opener when closed', async () => {
		opener.focus();
		const { rerender } = render(NotificationModal, { isOpen: true, onClose: vi.fn() });
		await tick();
		expect(document.activeElement?.getAttribute('role')).toBe('dialog');

		await rerender({ isOpen: false });
		await tick();
		expect(document.activeElement).toBe(opener);
	});
});
