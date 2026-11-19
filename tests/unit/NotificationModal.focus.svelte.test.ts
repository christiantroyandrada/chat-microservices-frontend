/**
 * Focus management tests for NotificationModal.
 *
 * aria-modal="true" promises focus containment: focus must move into the
 * dialog on open (so Escape works immediately), Tab must cycle inside it,
 * and focus must return to the opener on close.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import NotificationModal from '$lib/components/NotificationModal.svelte';
import { notificationStore } from '$lib/stores/notification.store';
import type { NotificationState } from '$lib/types';

const store = vi.hoisted(() => ({ set: (_state: NotificationState) => {} }));

vi.mock('$lib/stores/notification.store', async () => {
	const { writable } = await import('svelte/store');
	const state = writable<NotificationState>();
	store.set = state.set;
	return {
		notificationStore: {
			subscribe: state.subscribe,
			markAsRead: vi.fn(),
			markAllAsRead: vi.fn(),
			delete: vi.fn()
		}
	};
});

describe('NotificationModal focus management', () => {
	let opener: HTMLButtonElement;

	beforeEach(() => {
		vi.clearAllMocks();
		store.set({ notifications: [], unreadCount: 0, loading: false });
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

	it('keeps focus in the dialog after Mark all read removes the focused button', async () => {
		const unread = {
			_id: 'notice',
			userId: 'recipient',
			title: 'New message',
			message: 'You have a new message',
			type: 'message' as const,
			createdAt: new Date().toISOString(),
			read: false
		};
		store.set({ notifications: [unread], unreadCount: 1, loading: false });
		vi.mocked(notificationStore.markAllAsRead).mockImplementationOnce(async () => {
			store.set({ notifications: [{ ...unread, read: true }], unreadCount: 0, loading: false });
		});

		const view = render(NotificationModal, { isOpen: true });
		const action = view.getByRole('button', { name: 'Mark all read' });
		action.focus();
		await fireEvent.click(action);
		await tick();
		expect(view.queryByRole('button', { name: 'Mark all read' })).toBeNull();
		await waitFor(() =>
			expect(view.getByRole('dialog').contains(document.activeElement)).toBe(true)
		);
	});
});
