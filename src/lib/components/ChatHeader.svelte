<script lang="ts">
	import type { ChatConversation } from '$lib/types';
	import { createEventDispatcher } from 'svelte';

	// Props (runes mode)
	let { recipient = null as ChatConversation | null, typingUsers = new Set<string>() } = $props();

	const dispatch = createEventDispatcher();
</script>

{#if recipient}
	<div class="chat-header p-3 md:p-4">
		<div class="flex items-center justify-between">
			<div class="header-user-info flex items-center gap-3">
				<!-- Avatar -->
				<div
					class="avatar-circle flex h-10 w-10 items-center justify-center rounded-full font-semibold text-white"
				>
					{(recipient.username?.[0] ?? '').toUpperCase()}
				</div>

				<div>
					<h3 class="username text-base font-semibold md:text-lg">
						{recipient.username}
					</h3>
					{#if typingUsers.has(recipient.userId)}
						<p class="typing-indicator text-sm">typing...</p>
					{:else}
						<p class="status-text text-sm">Online</p>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-2">
				<button
					onclick={() => dispatch('call')}
					class="header-button hover-bg-accent rounded-full p-2 transition-all"
					title="Video call"
					aria-label="Start video call"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>
				</button>
				<button
					onclick={() => dispatch('info')}
					class="header-button hover-bg-accent rounded-full p-2 transition-all"
					title="User info"
					aria-label="View user information"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				</button>
			</div>
		</div>
	</div>
{:else}
	<div class="chat-header-empty p-4">
		<div class="empty-message text-center">Select a conversation</div>
	</div>
{/if}

<style>
	.chat-header {
		background: var(--bg-primary);
		border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
	}

	.header-user-info {
		animation: fadeIn 0.3s ease-out;
	}

	.avatar-circle {
		background: var(--gradient-accent);
	}

	.username {
		color: var(--text-primary);
	}

	.typing-indicator {
		color: var(--accent-primary);
		animation: fadeIn 0.2s ease-out;
	}

	.status-text {
		color: var(--text-tertiary);
	}

	.header-button {
		color: var(--text-secondary);
		background: transparent;
	}

	.header-button:hover {
		background: var(--bg-hover);
	}

	.chat-header-empty {
		background: var(--bg-primary);
		border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
	}

	.empty-message {
		color: var(--text-secondary);
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
