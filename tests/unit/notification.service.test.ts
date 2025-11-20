/**
 * Unit tests for notification service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NotificationPayload } from '$lib/types';
import { safeToString } from '$lib/utils';

// Mock API client
const mockApiClient = {
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
	patch: vi.fn()
};

vi.mock('$lib/services/api', () => ({
	apiClient: mockApiClient
}));

const mockLogger = {
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn(),
	success: vi.fn()
};

vi.mock('$lib/services/dev-logger', () => ({
	logger: mockLogger
}));

// Mock normalizeNotification utility
vi.mock('$lib/utils', () => ({
	safeToString: String,
	normalizeNotification: vi.fn((data: unknown) => {
		const d = data as Record<string, unknown>;
		return {
			id: safeToString(d['_id'] ?? d['id'] ?? '1'),
			type: (d['type'] as string) ?? 'message',
			title: (d['title'] as string) ?? 'Test',
			message: (d['message'] as string) ?? 'Test message',
			read: Boolean(d['read'] ?? false),
			timestamp: safeToString(d['timestamp'] ?? new Date().toISOString()),
			userId: safeToString(d['userId'] ?? 'user-123')
		};
	})
}));

const { notificationService } = await import('$lib/services/notification.service');

// Helper to create success response
const createSuccessResponse = <T>(data: T) => ({
	data,
	status: 200,
	statusText: 'OK',
	headers: {}
});

describe('notificationService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getNotifications', () => {
		it('should fetch notifications successfully', async () => {
			const mockNotifications = [
				{ _id: '1', type: 'message', title: 'New message', message: 'You have a new message' }
			];
			mockApiClient.get.mockResolvedValue(createSuccessResponse(mockNotifications));

			const result = await notificationService.getNotifications();

			expect(mockApiClient.get).toHaveBeenCalledWith('/notifications/?limit=20&offset=0');
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('1');
		});

		it('should handle custom limit and offset', async () => {
			mockApiClient.get.mockResolvedValue(createSuccessResponse([]));

			await notificationService.getNotifications(10, 5);

			expect(mockApiClient.get).toHaveBeenCalledWith('/notifications/?limit=10&offset=5');
		});

		it('should return empty array on error', async () => {
			mockApiClient.get.mockRejectedValue(new Error('Network error'));

			const result = await notificationService.getNotifications();

			expect(result).toEqual([]);
			expect(mockLogger.warning).toHaveBeenCalled();
		});
	});

	describe('getUnreadCount', () => {
		it('should fetch unread count successfully', async () => {
			mockApiClient.get.mockResolvedValue(createSuccessResponse({ count: 5 }));

			const result = await notificationService.getUnreadCount();

			expect(mockApiClient.get).toHaveBeenCalledWith('/notifications/unread/count');
			expect(result).toBe(5);
		});

		it('should return 0 on error', async () => {
			mockApiClient.get.mockRejectedValue(new Error('Network error'));

			const result = await notificationService.getUnreadCount();

			expect(result).toBe(0);
			expect(mockLogger.warning).toHaveBeenCalled();
		});
	});

	describe('markAsRead', () => {
		it('should mark notification as read', async () => {
			mockApiClient.put.mockResolvedValue(createSuccessResponse({}));

			await notificationService.markAsRead('notif-123');

			expect(mockApiClient.put).toHaveBeenCalledWith('/notifications/notif-123/read');
		});

		it('should handle error gracefully', async () => {
			mockApiClient.put.mockRejectedValue(new Error('Network error'));

			await notificationService.markAsRead('notif-123');

			expect(mockLogger.warning).toHaveBeenCalled();
		});
	});

	describe('markAllAsRead', () => {
		it('should mark all notifications as read', async () => {
			mockApiClient.put.mockResolvedValue(createSuccessResponse({}));

			await notificationService.markAllAsRead();

			expect(mockApiClient.put).toHaveBeenCalledWith('/notifications/read-all');
		});

		it('should handle error gracefully', async () => {
			mockApiClient.put.mockRejectedValue(new Error('Network error'));

			await notificationService.markAllAsRead();

			expect(mockLogger.warning).toHaveBeenCalled();
		});
	});

	describe('deleteNotification', () => {
		it('should delete a notification', async () => {
			mockApiClient.delete.mockResolvedValue(createSuccessResponse({}));

			await notificationService.deleteNotification('notif-123');

			expect(mockApiClient.delete).toHaveBeenCalledWith('/notifications/notif-123');
		});

		it('should handle error gracefully', async () => {
			mockApiClient.delete.mockRejectedValue(new Error('Network error'));

			await notificationService.deleteNotification('notif-123');

			expect(mockLogger.warning).toHaveBeenCalled();
		});
	});

	describe('sendNotification', () => {
		it('should send a notification', async () => {
			const payload: NotificationPayload = {
				type: 'message',
				title: 'New message',
				message: 'You have a new message'
			};
			const mockResponse = { _id: '1', ...payload, userId: 'user-123' };
			mockApiClient.post.mockResolvedValue(createSuccessResponse(mockResponse));

			const result = await notificationService.sendNotification(payload);

			expect(mockApiClient.post).toHaveBeenCalledWith('/notifications', payload);
			expect(result.id).toBe('1');
		});

		it('should throw error on failure', async () => {
			const payload: NotificationPayload = {
				type: 'message',
				title: 'New message',
				message: 'You have a new message'
			};
			mockApiClient.post.mockRejectedValue(new Error('Network error'));

			await expect(notificationService.sendNotification(payload)).rejects.toThrow();
			expect(mockLogger.warning).toHaveBeenCalled();
		});
	});
});
