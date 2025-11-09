import { writable, derived } from 'svelte/store';
import { notificationService } from '$lib/services/notification.service';
import type { Notification, NotificationState } from '$lib/types';

const initialState: NotificationState = {
	notifications: [],
	unreadCount: 0,
	loading: false
};

function createNotificationStore() {
	const { subscribe, set, update } = writable<NotificationState>(initialState);

	return {
		subscribe,

		/**
		 * Fetch notifications from server
		 */
		async fetch(limit = 20, offset = 0) {
			update((state) => ({ ...state, loading: true }));

			try {
				const notifications = await notificationService.getNotifications(limit, offset);
				const unreadCount = await notificationService.getUnreadCount();

				update((state) => ({
					...state,
					notifications,
					unreadCount,
					loading: false
				}));
			} catch (error) {
				console.error('Failed to fetch notifications:', error);
				update((state) => ({ ...state, loading: false }));
			}
		},

		/**
		 * Add a new notification
		 */
		add(notification: Notification) {
			update((state) => ({
				...state,
				notifications: [notification, ...state.notifications],
				unreadCount: notification.read ? state.unreadCount : state.unreadCount + 1
			}));
		},

		/**
		 * Mark notification as read
		 */
		async markAsRead(notificationId: string) {
			try {
				await notificationService.markAsRead(notificationId);

				update((state) => ({
					...state,
					notifications: state.notifications.map((n) =>
						n._id === notificationId ? { ...n, read: true } : n
					),
					unreadCount: Math.max(0, state.unreadCount - 1)
				}));
			} catch (error) {
				console.error('Failed to mark notification as read:', error);
			}
		},

		/**
		 * Mark all notifications as read
		 */
		async markAllAsRead() {
			try {
				await notificationService.markAllAsRead();

				update((state) => ({
					...state,
					notifications: state.notifications.map((n) => ({ ...n, read: true })),
					unreadCount: 0
				}));
			} catch (error) {
				console.error('Failed to mark all notifications as read:', error);
			}
		},

		/**
		 * Delete a notification
		 */
		async delete(notificationId: string) {
			try {
				await notificationService.deleteNotification(notificationId);

				update((state) => {
					const notification = state.notifications.find((n) => n._id === notificationId);
					return {
						...state,
						notifications: state.notifications.filter((n) => n._id !== notificationId),
						unreadCount:
							notification && !notification.read
								? Math.max(0, state.unreadCount - 1)
								: state.unreadCount
					};
				});
			} catch (error) {
				console.error('Failed to delete notification:', error);
			}
		},

		/**
		 * Clear all notifications
		 */
		clear() {
			set(initialState);
		}
	};
}

export const notificationStore = createNotificationStore();

// Derived stores
export const unreadCount = derived(notificationStore, ($store) => $store.unreadCount);
export const notifications = derived(notificationStore, ($store) => $store.notifications);
