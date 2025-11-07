import { apiClient } from './api';
import type { Notification, NotificationPayload } from '$lib/types';

export const notificationService = {
	/**
	 * Get all notifications for current user
	 */
	async getNotifications(limit = 20, offset = 0): Promise<Notification[]> {
		const response = await apiClient.get<Notification[]>(
			`/api/notifications?limit=${limit}&offset=${offset}`
		);
		return response.data || [];
	},

	/**
	 * Get unread notification count
	 */
	async getUnreadCount(): Promise<number> {
		const response = await apiClient.get<{ count: number }>('/api/notifications/unread/count');
		return response.data?.count || 0;
	},

	/**
	 * Mark a notification as read
	 */
	async markAsRead(notificationId: string): Promise<void> {
		await apiClient.put(`/api/notifications/${notificationId}/read`);
	},

	/**
	 * Mark all notifications as read
	 */
	async markAllAsRead(): Promise<void> {
		await apiClient.put('/api/notifications/read-all');
	},

	/**
	 * Delete a notification
	 */
	async deleteNotification(notificationId: string): Promise<void> {
		await apiClient.delete(`/api/notifications/${notificationId}`);
	},

	/**
	 * Send a notification (admin only)
	 */
	async sendNotification(payload: NotificationPayload): Promise<Notification> {
		const response = await apiClient.post<Notification>('/api/notifications', payload);
		return response.data!;
	}
};
