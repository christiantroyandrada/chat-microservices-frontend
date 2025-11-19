/**
 * Unit tests for notification.store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock dependencies
const mockNotificationService = {
	getNotifications: vi.fn(),
	getUnreadCount: vi.fn(),
	markAsRead: vi.fn(),
	markAllAsRead: vi.fn(),
	deleteNotification: vi.fn()
};

vi.mock('$lib/services/notification.service', () => ({
	notificationService: mockNotificationService
}));

vi.mock('$lib/utils', () => ({
	normalizeNotification: vi.fn((n) => n)
}));

const mockLogger = {
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn()
};

vi.mock('$lib/services/dev-logger', () => ({
	logger: mockLogger
}));

describe('notificationStore', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it('should initialize with empty state', async () => {
		const { notificationStore } = await import('$lib/stores/notification.store');
		const state = get(notificationStore);
		expect(state.notifications).toEqual([]);
		expect(state.unreadCount).toBe(0);
		expect(state.loading).toBe(false);
	});

	it('should fetch notifications', async () => {
		const mockNotifications = [
			{ _id: '1', type: 'message', title: 'New message', message: 'Hello', read: false },
			{ _id: '2', type: 'info', title: 'Update', message: 'System update', read: true }
		];
		mockNotificationService.getNotifications.mockResolvedValue(mockNotifications);
		mockNotificationService.getUnreadCount.mockResolvedValue(1);

		const { notificationStore } = await import('$lib/stores/notification.store');
		await notificationStore.fetch(20, 0);

		const state = get(notificationStore);
		expect(state.notifications).toEqual(mockNotifications);
		expect(state.unreadCount).toBe(1);
		expect(state.loading).toBe(false);
	});

	it('should handle fetch error', async () => {
		mockNotificationService.getNotifications.mockRejectedValue(new Error('Network error'));

		const { notificationStore } = await import('$lib/stores/notification.store');
		await notificationStore.fetch();

		const state = get(notificationStore);
		expect(state.loading).toBe(false);
		expect(mockLogger.error).toHaveBeenCalled();
	});

	it('should mark notification as read', async () => {
		const mockNotifications = [
			{ _id: '1', type: 'message', title: 'New message', message: 'Hello', read: false }
		];
		mockNotificationService.getNotifications.mockResolvedValue(mockNotifications);
		mockNotificationService.getUnreadCount.mockResolvedValue(1);
		mockNotificationService.markAsRead.mockResolvedValue(undefined);

		const { notificationStore } = await import('$lib/stores/notification.store');
		await notificationStore.fetch();
		await notificationStore.markAsRead('1');

		expect(mockNotificationService.markAsRead).toHaveBeenCalledWith('1');
	});

	it('should mark all notifications as read', async () => {
		mockNotificationService.markAllAsRead.mockResolvedValue(undefined);
		mockNotificationService.getNotifications.mockResolvedValue([]);
		mockNotificationService.getUnreadCount.mockResolvedValue(0);

		const { notificationStore } = await import('$lib/stores/notification.store');
		await notificationStore.markAllAsRead();

		expect(mockNotificationService.markAllAsRead).toHaveBeenCalled();
	});

	it('should delete notification', async () => {
		mockNotificationService.deleteNotification.mockResolvedValue(undefined);
		mockNotificationService.getNotifications.mockResolvedValue([]);
		mockNotificationService.getUnreadCount.mockResolvedValue(0);

		const { notificationStore } = await import('$lib/stores/notification.store');
		await notificationStore.delete('1');

		expect(mockNotificationService.deleteNotification).toHaveBeenCalledWith('1');
	});

	it('should add notification', async () => {
		mockNotificationService.getNotifications.mockResolvedValue([]);
		mockNotificationService.getUnreadCount.mockResolvedValue(0);

		const { notificationStore } = await import('$lib/stores/notification.store');
		await notificationStore.fetch();

		const newNotification = {
			_id: '1',
			type: 'message' as const,
			title: 'New',
			message: 'Test',
			read: false,
			createdAt: new Date(),
			userId: 'user1'
		};

		notificationStore.add(newNotification);

		const state = get(notificationStore);
		expect(state.notifications.length).toBe(1);
		expect(state.unreadCount).toBe(1);
	});

	it('should clear notifications', async () => {
		const { notificationStore } = await import('$lib/stores/notification.store');
		notificationStore.clear();

		const state = get(notificationStore);
		expect(state.notifications).toEqual([]);
		expect(state.unreadCount).toBe(0);
	});
});
