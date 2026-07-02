<script lang="ts">
	import type { ChatConversation } from '$lib/types';
	import Seal from '$lib/components/Seal.svelte';

	// Props (runes mode) - accept a callback prop for the back action in Svelte 5
	let {
		recipient = null as ChatConversation | null,
		isTyping = false,
		back = null as (() => void) | null
	} = $props();

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
		<div class="flex items-center justify-between gap-3">
			<div class="header-user-info flex min-w-0 items-center gap-3">
				<!-- Back button (mobile only) -->
				<button
					class="back-btn rounded p-2"
					type="button"
					onclick={() => back?.()}
					aria-label="Back to conversations"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M9.707 14.707a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5A1 1 0 0110.414 4.293L6.121 8.586H17a1 1 0 110 2H6.121l4.293 4.293a1 1 0 010 1.414z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
				<div class="avatar-circle flex h-10 w-10 items-center justify-center rounded-full">
					{(recipient.username?.[0] ?? '').toUpperCase()}
				</div>

				<div class="min-w-0">
					<h3 class="username truncate">{recipient.username}</h3>
					{#if isTyping}
						<div class="status-text flex items-center gap-1">
							<span>writing</span>
							<span class="typing-dots">
								<span class="dot"></span>
								<span class="dot"></span>
								<span class="dot"></span>
							</span>
						</div>
					{:else}
						<p class="status-text">{getStatusText()}</p>
					{/if}
				</div>
			</div>

			<!-- E2EE indicator: this conversation is sealed -->
			<div class="seal-status" title="This conversation is end-to-end encrypted">
				<Seal size={20} title="End-to-end encrypted" />
				<span class="seal-status__label eyebrow">Sealed</span>
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
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border-subtle);
	}

	.chat-header .header-user-info {
		animation: fadeIn 0.3s ease-out;
	}

	.chat-header .avatar-circle {
		flex: none;
		background: var(--accent-primary);
		color: var(--accent-contrast);
		font-family: var(--font-serif);
		font-weight: 600;
		font-size: var(--text-lg);
		box-shadow: var(--shadow-cta);
	}

	.chat-header .username {
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text-primary);
	}

	.chat-header .status-text {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.back-btn {
		color: var(--text-secondary);
		transition: color var(--dur-fast) ease;
	}
	.back-btn:hover {
		color: var(--accent-primary);
	}

	.seal-status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		flex: none;
	}
	.seal-status__label {
		color: var(--text-tertiary);
	}
	@media (max-width: 640px) {
		.seal-status__label {
			display: none;
		}
	}

	.chat-header .typing-dots {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.chat-header .typing-dots .dot {
		width: 4px;
		height: 4px;
		background-color: var(--accent-primary);
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
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border-subtle);

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
