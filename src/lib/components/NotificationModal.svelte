<script lang="ts">
	import { notificationStore } from '$lib/stores/notification.store';
	import type { Notification } from '$lib/types';

	export let isOpen = false;
	export let onClose: () => void = () => {};

	$: notifications = $notificationStore.notifications;
	$: loading = $notificationStore.loading;

	async function handleMarkAsRead(notificationId: string) {
		await notificationStore.markAsRead(notificationId);
	}

	async function handleMarkAllAsRead() {
		await notificationStore.markAllAsRead();
	}

	async function handleDelete(notificationId: string) {
		await notificationStore.delete(notificationId);
	}

	function getNotificationIcon(type: Notification['type']) {
		switch (type) {
			case 'message':
				return '💬';
			case 'alert':
				return '⚠️';
			case 'system':
				return 'ℹ️';
			default:
				return '🔔';
		}
	}

	function formatTimestamp(timestamp: string) {
		const date = new Date(timestamp);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return date.toLocaleDateString();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}
</script>

{#if isOpen}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-16"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-labelledby="notification-modal-title"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="relative mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
				<h2 id="notification-modal-title" class="text-xl font-semibold text-gray-900">
					Notifications
				</h2>
				<div class="flex items-center gap-2">
					{#if notifications.length > 0 && notifications.some((n) => !n.read)}
						<button
							onclick={handleMarkAllAsRead}
							class="rounded-md px-3 py-1 text-sm text-blue-600 hover:bg-blue-50"
							title="Mark all as read"
						>
							Mark all read
						</button>
					{/if}
					<button
						onclick={onClose}
						class="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						aria-label="Close"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>
			</div>

			<div class="max-h-96 overflow-y-auto">
				{#if loading}
					<div class="flex items-center justify-center py-12">
						<div class="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
					</div>
				{:else if notifications.length === 0}
					<div class="flex flex-col items-center justify-center py-12 text-gray-500">
						<svg
							class="mb-3 h-16 w-16 text-gray-300"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
							/>
						</svg>
						<p class="text-sm">No notifications yet</p>
					</div>
				{:else}
					<ul class="divide-y divide-gray-200">
						{#each notifications as notification (notification._id)}
							<li
								class="group relative px-6 py-4 transition-colors hover:bg-gray-50"
								class:bg-blue-50={!notification.read}
							>
								<div class="flex items-start gap-3">
									<div class="mt-1 text-2xl">
										{getNotificationIcon(notification.type)}
									</div>

									<div class="flex-1 min-w-0">
										<div class="flex items-start justify-between gap-2">
											<h3 class="font-medium text-gray-900" class:font-semibold={!notification.read}>
												{notification.title}
											</h3>
											{#if !notification.read}
												<span class="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-2"></span>
											{/if}
										</div>
										<p class="mt-1 text-sm text-gray-600">
											{notification.message}
										</p>
										<p class="mt-1 text-xs text-gray-400">
											{formatTimestamp(notification.createdAt)}
										</p>
									</div>

									<div class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
										<div class="flex gap-1">
											{#if !notification.read}
												<button
													onclick={() => handleMarkAsRead(notification._id)}
													class="rounded p-1 text-blue-600 hover:bg-blue-100"
													title="Mark as read"
												>
													<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M5 13l4 4L19 7"
														/>
													</svg>
												</button>
											{/if}
											<button
												onclick={() => handleDelete(notification._id)}
												class="rounded p-1 text-red-600 hover:bg-red-100"
												title="Delete"
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
													/>
												</svg>
											</button>
										</div>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if notifications.length > 0}
				<div class="border-t border-gray-200 px-6 py-3 text-center">
					<button
						onclick={onClose}
						class="text-sm font-medium text-blue-600 hover:text-blue-700"
					>
						Close
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.overflow-y-auto::-webkit-scrollbar {
		width: 6px;
	}

	.overflow-y-auto::-webkit-scrollbar-track {
		background: #f1f1f1;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb {
		background: #888;
		border-radius: 3px;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb:hover {
		background: #555;
	}
</style>
