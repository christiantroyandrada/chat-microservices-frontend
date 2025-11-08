import { apiClient } from './api';
import type { Notification, NotificationPayload } from '$lib/types';

export const notificationService = {
	/**
	 * Get all notifications for current user
	 */
	async getNotifications(limit = 20, offset = 0): Promise<Notification[]> {
		try {
			// include trailing slash so nginx location /notifications/ matches and doesn't redirect
			const response = await apiClient.get<Notification[]>(
				`/notifications/?limit=${limit}&offset=${offset}`
			);
			return response.data || [];
		} catch (err) {
			console.warn('notificationService.getNotifications failed, returning empty list', err);
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
			console.warn('notificationService.getUnreadCount failed, returning 0', err);
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
			console.warn('notificationService.markAsRead failed', err);
		}
	},

	/**
	 * Mark all notifications as read
	 */
	async markAllAsRead(): Promise<void> {
		try {
			await apiClient.put('/notifications/read-all');
		} catch (err) {
			console.warn('notificationService.markAllAsRead failed', err);
		}
	},

	/**
	 * Delete a notification
	 */
	async deleteNotification(notificationId: string): Promise<void> {
		try {
			await apiClient.delete(`/notifications/${notificationId}`);
		} catch (err) {
			console.warn('notificationService.deleteNotification failed', err);
		}
	},

	/**
	 * Send a notification (admin only)
	 */
	async sendNotification(payload: NotificationPayload): Promise<Notification> {
		try {
			const response = await apiClient.post<Notification>('/notifications', payload);
			return response.data!;
		} catch (err) {
			console.warn('notificationService.sendNotification failed', err);
			throw err;
		}
	}
};
