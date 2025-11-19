import { apiClient } from './api';
import type { Notification, NotificationPayload } from '$lib/types';
import { normalizeNotification } from '$lib/utils';
import { logger } from './dev-logger';

/**
 * Notification service for managing user notifications
 */
export const notificationService = {
	/**
	 * Get all notifications for current user
	 */
	async getNotifications(limit = 20, offset = 0): Promise<Notification[]> {
		try {
			// Use canonical `/notifications` prefix
			const response = await apiClient.get<unknown>(
				`/notifications/?limit=${limit}&offset=${offset}`
			);

			const raw = response.data as Array<unknown>;

			// Normalize backend shape to frontend `Notification` type
			return (raw || []).map((n: unknown, idx: number) => normalizeNotification(n, idx));
		} catch (err) {
			logger.warning('notificationService.getNotifications failed, returning empty list', err);
			return [];
		}
	},

	/**
	 * Get unread notification count
	 */
	async getUnreadCount(): Promise<number> {
		try {
			const response = await apiClient.get<{ count: number }>('/notifications/unread/count');
			return response.data?.count || 0;
		} catch (err) {
			logger.warning('notificationService.getUnreadCount failed, returning 0', err);
			return 0;
		}
	},

	/**
	 * Mark a notification as read
	 */
	async markAsRead(notificationId: string): Promise<void> {
		try {
			await apiClient.put(`/notifications/${notificationId}/read`);
		} catch (err) {
			logger.warning('notificationService.markAsRead failed', err);
		}
	},

	/**
	 * Mark all notifications as read
	 */
	async markAllAsRead(): Promise<void> {
		try {
			await apiClient.put('/notifications/read-all');
		} catch (err) {
			logger.warning('notificationService.markAllAsRead failed', err);
		}
	},

	/**
	 * Delete a notification
	 */
	async deleteNotification(notificationId: string): Promise<void> {
		try {
			await apiClient.delete(`/notifications/${notificationId}`);
		} catch (err) {
			logger.warning('notificationService.deleteNotification failed', err);
		}
	},

	/**
	 * Send a notification (admin only)
	 */
	async sendNotification(payload: NotificationPayload): Promise<Notification> {
		try {
			const response = await apiClient.post<unknown>('/notifications', payload);
			const raw = response.data;
			// reuse normalization logic (recreate same inline logic)
			return normalizeNotification(raw);
		} catch (err) {
			logger.warning('notificationService.sendNotification failed', err);
			throw err;
		}
	}
};
