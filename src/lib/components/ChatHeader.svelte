<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { ChatConversation } from '$lib/types';

	const dispatch = createEventDispatcher<{ back: void }>();

	// Props (runes mode)
	let { recipient = null as ChatConversation | null, isTyping = false } = $props();

	function getStatusText(): string {
		if (!recipient) return '';
		
		// Show typing indicator if user is actively typing
		if (isTyping) return 'typing...';
		
		// Prioritize real-time presence data from websocket
		if (recipient.online !== undefined) {
			if (recipient.online) return 'Online';
			
			// User is offline, format lastSeen if available
			if (recipient.lastSeen) {
				const diffMs = Date.now() - new Date(recipient.lastSeen).getTime();
				const minutes = Math.floor(diffMs / 60000);
				if (minutes < 60) return `Active ${minutes}m ago`;
				const hours = Math.floor(minutes / 60);
				if (hours < 24) return `Active ${hours}h ago`;
				return `Last active ${new Date(recipient.lastSeen).toLocaleDateString()}`;
			}
			return 'Offline';
		}
		
		// Fallback: use lastMessageTime as activity proxy (legacy behavior)
		if (!recipient.lastMessageTime) return 'Offline';

		const diffMs = Date.now() - new Date(recipient.lastMessageTime).getTime();
		const minutes = Math.floor(diffMs / 60000);
		if (minutes < 2) return 'Online';
		if (minutes < 60) return `Active ${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `Active ${hours}h ago`;
		return `Last active ${new Date(recipient.lastMessageTime).toLocaleDateString()}`;
	}
</script>

{#if recipient}
	<div class="chat-header p-3 md:p-4">
		<div class="flex items-center justify-between">
			<div class="header-user-info flex items-center gap-3">
				<!-- Avatar -->
				<!-- Back button (mobile only) -->
				<button
					class="back-btn mr-2 md:hidden p-2 rounded"
					type="button"
					onclick={() => dispatch('back')}
					aria-label="Back to conversations"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path fill-rule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5A1 1 0 0110.414 4.293L6.121 8.586H17a1 1 0 110 2H6.121l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
					</svg>
				</button>
				<div
					class="avatar-circle flex h-10 w-10 items-center justify-center rounded-full font-semibold text-white"
				>
					{(recipient.username?.[0] ?? '').toUpperCase()}
				</div>

				<div>
					<h3 class="username text-base font-semibold md:text-lg">
						{recipient.username}
					</h3>
					{#if isTyping}
						<div class="status-text text-sm flex items-center gap-1">
							<span>typing</span>
							<span class="typing-dots">
								<span class="dot"></span>
								<span class="dot"></span>
								<span class="dot"></span>
							</span>
						</div>
					{:else}
						<p class="status-text text-sm">{getStatusText()}</p>
					{/if}
				</div>
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

	.chat-header .header-user-info {
		animation: fadeIn 0.3s ease-out;
	}

	.chat-header .avatar-circle {
		background: var(--gradient-accent);
	}

	.chat-header .username {
		color: var(--text-primary);
	}

	.chat-header .status-text {
		color: var(--text-tertiary);
	}

	.chat-header .typing-dots {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.chat-header .typing-dots .dot {
		width: 4px;
		height: 4px;
		background-color: var(--text-tertiary);
		border-radius: 50%;
		display: inline-block;
		animation: typing-bounce 1.4s infinite ease-in-out;
	}

	.chat-header .typing-dots .dot:nth-child(1) {
		animation-delay: 0s;
	}

	.chat-header .typing-dots .dot:nth-child(2) {
		animation-delay: 0.2s;
	}

	.chat-header .typing-dots .dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes typing-bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.7;
		}
		30% {
			transform: translateY(-8px);
			opacity: 1;
		}
	}

	.chat-header-empty {
		background: var(--bg-primary);
		border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));

		.empty-message {
			color: var(--text-secondary);
		}
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
