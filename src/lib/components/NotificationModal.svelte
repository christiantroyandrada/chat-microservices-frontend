<script lang="ts">
	import { tick } from 'svelte';
	import { notificationStore } from '$lib/stores/notification.store';
	import type { Notification } from '$lib/types';

	// Svelte 5 runes: use $props() instead of export let
	let { isOpen = false, onClose = () => {} }: { isOpen?: boolean; onClose?: () => void } = $props();

	let backdropEl = $state<HTMLDivElement | null>(null);

	// Move focus into the dialog on open so Escape/Tab work immediately,
	// and hand it back to the opener on close.
	$effect(() => {
		if (!isOpen || !backdropEl) return;
		const opener = document.activeElement as HTMLElement | null;
		backdropEl.focus();
		return () => opener?.focus();
	});

	// Derive reactive values from store
	let notifications = $derived.by(() => $notificationStore.notifications);
	let loading = $derived.by(() => $notificationStore.loading);

	async function keepFocusAfter(action: () => Promise<void>) {
		const dialog = backdropEl;
		const focused = document.activeElement;
		const hadFocus = dialog?.contains(focused);
		await action();
		await tick();
		if (
			hadFocus &&
			dialog &&
			backdropEl === dialog &&
			!focused?.isConnected &&
			document.activeElement === document.body
		) {
			dialog.focus();
		}
	}

	async function handleMarkAsRead(notificationId?: string) {
		if (!notificationId) return;
		await keepFocusAfter(() => notificationStore.markAsRead(notificationId));
	}

	async function handleMarkAllAsRead() {
		await keepFocusAfter(notificationStore.markAllAsRead);
	}

	async function handleDelete(notificationId?: string) {
		if (!notificationId) return;
		await keepFocusAfter(() => notificationStore.delete(notificationId));
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

	function formatTimestamp(timestamp: string | Date) {
		const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
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

	function handleBackdropKeydown(e: KeyboardEvent) {
		// Close on Escape
		if (e.key === 'Escape') {
			onClose();
			return;
		}
		// aria-modal promises containment: keep Tab cycling inside the dialog
		if (e.key === 'Tab' && backdropEl) {
			const focusable = backdropEl.querySelectorAll<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (
				e.shiftKey &&
				(document.activeElement === first || document.activeElement === backdropEl)
			) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}
</script>

{#if isOpen}
	<div
		class="notification-backdrop animate-fade-in fixed inset-0 z-50 flex items-start justify-center p-3 sm:px-4 sm:pt-16"
		onclick={handleBackdropClick}
		onkeydown={handleBackdropKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="notification-modal-title"
		tabindex="-1"
		bind:this={backdropEl}
	>
		<div
			class="notification-modal animate-scale-in relative flex max-h-full min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-2xl"
			role="document"
		>
			<div
				class="modal-header flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6"
			>
				<div>
					<h2 id="notification-modal-title" class="modal-title text-xl font-semibold">
						Notifications
					</h2>
					<p class="modal-subtitle mt-0.5 text-sm">
						{notifications.length}
						{notifications.length === 1 ? 'notification' : 'notifications'}
					</p>
				</div>
				<div class="flex items-center gap-2">
					{#if notifications.length > 0 && notifications.some((n) => !n.read)}
						<button
							onclick={handleMarkAllAsRead}
							class="mark-all-btn hover-lift btn rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200"
							title="Mark all as read"
						>
							Mark all read
						</button>
					{/if}
					<button
						onclick={onClose}
						class="close-btn hover-lift rounded-lg p-2 transition-all duration-200"
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

			<div class="notification-list min-h-0 overflow-y-auto overscroll-contain">
				{#if loading}
					<div class="flex items-center justify-center py-16">
						<div
							class="loading-spinner h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"
						></div>
					</div>
				{:else if notifications.length === 0}
					<div class="empty-state flex flex-col items-center justify-center py-16">
						<div class="empty-icon mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
							<svg class="icon h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
								/>
							</svg>
						</div>
						<p class="empty-title font-medium">No notifications yet</p>
						<p class="empty-subtitle mt-1 text-sm">
							When you get notifications, they'll show up here
						</p>
					</div>
				{:else}
					<ul class="notification-items divide-y">
						{#each notifications as notification (notification._id ?? notification.id)}
							<li class="notification-item px-4 py-4 sm:px-6" class:unread={!notification.read}>
								<div class="flex items-start gap-4">
									<div
										aria-hidden="true"
										class="notification-icon mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
									>
										<span class="text-lg">{getNotificationIcon(notification.type)}</span>
									</div>

									<div class="min-w-0 flex-1">
										<div class="mb-1 flex items-start justify-between gap-2">
											<h3
												class="notification-title font-medium wrap-anywhere"
												class:font-semibold={!notification.read}
											>
												{notification.title}
											</h3>
											{#if !notification.read}
												<span
													class="unread-dot mt-2 h-2 w-2 shrink-0 rounded-full"
													aria-hidden="true"
												></span>
												<span class="sr-only">Unread</span>
											{/if}
										</div>
										<p class="notification-message mb-2 text-sm">
											{notification.message}
										</p>
										<p class="notification-time text-xs">
											{formatTimestamp(notification.createdAt)}
										</p>
									</div>

									<div class="shrink-0">
										<div class="flex gap-1">
											{#if !notification.read}
												<button
													onclick={() => handleMarkAsRead(notification._id ?? notification.id)}
													class="action-btn-read hover-lift btn rounded-lg p-2 transition-all duration-200"
													aria-label="Mark as read"
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
												onclick={() => handleDelete(notification._id ?? notification.id)}
												class="action-btn-delete hover-lift btn rounded-lg p-2 transition-all duration-200"
												title="Delete"
												aria-label="Delete notification"
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
		</div>
	</div>
{/if}

<style>
	/* Use PostCSS nesting for clarity: base backdrop contains modal and children */
	.notification-backdrop {
		background: var(--modal-backdrop);

		.notification-modal {
			box-shadow: var(--shadow-strong);
			background: var(--modal-bg);
			border: 1px solid var(--modal-border);

			.modal-header {
				border-bottom: 1px solid var(--border-subtle);
			}

			.modal-title {
				color: var(--text-primary);
			}

			.modal-subtitle {
				color: var(--text-tertiary);
			}

			.mark-all-btn {
				background: var(--accent-primary);
				color: var(--accent-contrast);
				border: 1px solid rgba(0, 0, 0, 0);
			}

			.close-btn {
				color: var(--text-tertiary);
				background: var(--bg-hover);
			}

			.loading-spinner {
				border-color: var(--accent-primary) transparent transparent transparent;
			}

			.empty-state {
				color: var(--text-secondary);

				.empty-icon {
					background: var(--bg-tertiary);
					border: 1px solid var(--modal-border);

					.icon {
						color: var(--text-tertiary);
					}
				}

				.empty-title {
					color: var(--text-primary);
				}

				.empty-subtitle {
					color: var(--text-tertiary);
				}
			}

			.notification-item {
				background: transparent;
				border-color: var(--border-subtle);

				&.unread {
					background: var(--bg-hover);
					position: relative;
				}
			}

			.notification-icon {
				background: var(--bg-tertiary);
				border: 1px solid var(--modal-border);
			}

			.notification-title {
				color: var(--text-primary);
			}

			.unread-dot {
				background: var(--accent-primary);
			}

			.notification-message {
				color: var(--text-secondary);
				overflow-wrap: anywhere;
			}

			.notification-time {
				color: var(--text-tertiary);
			}

			.action-btn-read {
				background: var(--accent-primary);
				color: var(--accent-contrast);
			}

			.action-btn-delete {
				background: var(--color-error-bg);
				color: var(--color-error);
				border: 1px solid var(--color-error-border);
			}

			.notification-list {
				&::-webkit-scrollbar {
					width: 6px;
				}

				&::-webkit-scrollbar-track {
					background: transparent;
				}

				&::-webkit-scrollbar-thumb {
					background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.08));
					border-radius: 3px;
					transition: background 0.2s;
				}

				&::-webkit-scrollbar-thumb:hover {
					background: var(--scrollbar-thumb-hover, rgba(255, 255, 255, 0.14));
				}
			}
		}
	}
</style>
