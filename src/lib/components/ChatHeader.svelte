<script lang="ts">
	import type { ChatConversation } from '$lib/types';

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

		.header-user-info {
			animation: fadeIn 0.3s ease-out;
		}

		.avatar-circle {
			background: var(--gradient-accent);
		}

		.username {
			color: var(--text-primary);
		}



		.status-text {
			color: var(--text-tertiary);
		}

		.typing-dots {
			display: inline-flex;
			align-items: center;
			gap: 2px;
		}

		.typing-dots .dot {
			width: 4px;
			height: 4px;
			background-color: var(--text-tertiary);
			border-radius: 50%;
			display: inline-block;
			animation: typing-bounce 1.4s infinite ease-in-out;
		}

		.typing-dots .dot:nth-child(1) {
			animation-delay: 0s;
		}

		.typing-dots .dot:nth-child(2) {
			animation-delay: 0.2s;
		}

		.typing-dots .dot:nth-child(3) {
			animation-delay: 0.4s;
		}
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
