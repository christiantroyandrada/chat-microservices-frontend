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
		class="animate-fade-in fixed inset-0 z-50 flex items-start justify-center px-4 pt-16"
		style="background: var(--modal-backdrop); backdrop-filter: blur(8px);"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-labelledby="notification-modal-title"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="glass-strong animate-scale-in relative w-full max-w-lg rounded-2xl"
			style="box-shadow: var(--shadow-strong); background: var(--modal-bg); border: 1px solid var(--modal-border);"
			onclick={(e) => e.stopPropagation()}
		>
			<div
				class="flex items-center justify-between px-6 py-5"
				style="border-bottom: 1px solid var(--border-subtle);"
			>
				<div>
					<h2
						id="notification-modal-title"
						class="text-xl font-semibold"
						style="color: var(--text-primary);"
					>
						Notifications
					</h2>
					<p class="mt-0.5 text-sm" style="color: var(--text-tertiary);">
						{notifications.length}
						{notifications.length === 1 ? 'notification' : 'notifications'}
					</p>
				</div>
				<div class="flex items-center gap-2">
					{#if notifications.length > 0 && notifications.some((n) => !n.read)}
						<button
							onclick={handleMarkAllAsRead}
							class="hover-lift btn rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200"
							style="background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); color: white; border: 1px solid rgba(0,0,0,0);"
							title="Mark all as read"
						>
							Mark all read
						</button>
					{/if}
					<button
						onclick={onClose}
						class="hover-lift rounded-lg p-2 transition-all duration-200"
						style="color: var(--text-tertiary); background: var(--bg-hover);"
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
					<div class="flex items-center justify-center py-16">
						<div
							class="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"
							style="border-color: var(--accent-primary) transparent transparent transparent;"
						></div>
					</div>
				{:else if notifications.length === 0}
					<div
						class="flex flex-col items-center justify-center py-16"
						style="color: var(--text-secondary);"
					>
						<div
							class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
							style="background: var(--bg-tertiary); border: 1px solid var(--modal-border);"
						>
							<svg
								class="h-8 w-8"
								style="color: var(--text-tertiary);"
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
						</div>
						<p class="font-medium" style="color: var(--text-primary);">No notifications yet</p>
						<p class="mt-1 text-sm" style="color: var(--text-tertiary);">
							When you get notifications, they'll show up here
						</p>
					</div>
				{:else}
					<ul class="divide-y" style="divide-color: var(--modal-border);">
						{#each notifications as notification (notification._id)}
							<li
								class="group relative px-6 py-4 transition-all duration-200"
								class:unread={!notification.read}
								style="background: {!notification.read ? 'var(--bg-hover)' : 'transparent'};"
							>
								<div class="flex items-start gap-4">
									<div
										class="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
										style="background: var(--bg-tertiary); border: 1px solid var(--modal-border);"
									>
										<span class="text-lg">{getNotificationIcon(notification.type)}</span>
									</div>

									<div class="min-w-0 flex-1">
										<div class="mb-1 flex items-start justify-between gap-2">
											<h3
												class="font-medium"
												style="color: var(--text-primary);"
												class:font-semibold={!notification.read}
											>
												{notification.title}
											</h3>
											{#if !notification.read}
												<span
													class="mt-2 h-2 w-2 shrink-0 rounded-full"
													style="background: var(--accent-primary); box-shadow: 0 0 8px var(--accent-primary);"
												></span>
											{/if}
										</div>
										<p class="mb-2 text-sm" style="color: var(--text-secondary);">
											{notification.message}
										</p>
										<p class="text-xs" style="color: var(--text-tertiary);">
											{formatTimestamp(notification.createdAt)}
										</p>
									</div>

									<div
										class="shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
									>
										<div class="flex gap-1">
											{#if !notification.read}
												<button
													onclick={() => handleMarkAsRead(notification._id)}
													class="hover-lift btn rounded-lg p-2 transition-all duration-200"
													style="background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); color: white;"
													title="Mark as read"
												>
													<svg
														class="h-4 w-4"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
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
												class="hover-lift btn rounded-lg p-2 transition-all duration-200"
												style="background: rgba(239, 68, 68, 0.06); color: #ef4444; border: 1px solid rgba(239,68,68,0.08);"
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
				<div class="px-6 py-4 text-center" style="border-top: 1px solid var(--modal-border);">
					<button
						onclick={onClose}
						class="text-sm font-medium transition-colors duration-200"
						style="color: var(--accent-secondary);"
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
		background: transparent;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb {
		background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.08));
		border-radius: 3px;
		transition: background 0.2s;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb:hover {
		background: var(--scrollbar-thumb-hover, rgba(255, 255, 255, 0.14));
	}

	.unread {
		position: relative;
	}

	.unread::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
		background: linear-gradient(180deg, var(--accent-primary), var(--accent-secondary));
		border-radius: 0 2px 2px 0;
	}
</style>
