<script lang="ts">
	import type { ChatConversation } from '$lib/types';
	import { chatService } from '$lib/services/chat.service';
	import { debounce } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.store';

	// Props for runes mode - using callback props instead of createEventDispatcher (Svelte 5)
	let {
		conversations = [] as ChatConversation[],
		selectedUserId = null as string | null,
		loading = false,
		currentUserId = null as string | null,
		onSelect = null as ((userId: string) => void) | null,
		onCreate = null as ((conversation: ChatConversation) => void) | null
	} = $props();

	// Create-conversation UI state (runes)
	let showCreate = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<ChatConversation[]>([]);
	let selectedUser = $state<ChatConversation | null>(null);
	let isSearching = $state(false);

	const performSearch = debounce(async (q: string) => {
		if (!q || q.trim().length < 1) {
			searchResults = [];
			return;
		}

		isSearching = true;
		try {
			// backend search may return full User objects; normalize to ChatConversation shape
			const users = await chatService.searchUsers(q.trim());
			searchResults = (users as unknown[])
				.map((u: unknown) => {
					const uu = u as Record<string, unknown>;
					return {
						userId: String(uu._id ?? uu.userId ?? uu.id ?? ''),
						username: String(uu.username ?? uu.name ?? 'Unknown'),
						lastMessage: undefined,
						lastMessageTime: undefined,
						unreadCount: 0
					} as ChatConversation;
				})
				.filter((u) => u.userId !== currentUserId);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Failed to search users';
			toastStore.error(message);
		} finally {
			isSearching = false;
		}
	}, 300);

	function openCreate() {
		showCreate = true;
		searchQuery = '';
		searchResults = [];
		selectedUser = null;
	}

	function closeCreate() {
		showCreate = false;
		searchQuery = '';
		searchResults = [];
		selectedUser = null;
	}

	function confirmCreate() {
		if (!selectedUser) return;
		// Call onCreate callback prop instead of dispatching event (Svelte 5)
		onCreate?.(selectedUser);
		closeCreate();
	}

	function formatTime(timestamp?: string): string {
		if (!timestamp) return '';
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

	function truncateMessage(message?: string, maxLength = 40): string {
		if (!message) return 'No messages yet';
		if (message.length <= maxLength) return message;
		return message.substring(0, maxLength) + '...';
	}

	function getConversationAriaLabel(conversation: ChatConversation) {
		const unread = conversation.unreadCount ? `, ${conversation.unreadCount} unread messages` : '';
		return `Chat with ${conversation.username}${unread}`;
	}
</script>

<div class="chat-list-container flex h-full flex-col">
	<!-- Messages Header -->
	<div class="messages-header p-4">
		<div class="flex items-center justify-between">
			<h2 class="messages-title">Correspondence</h2>
			<button
				onclick={openCreate}
				class="new-chat-button ml-2 inline-flex items-center justify-center rounded-md p-2"
				aria-label="Start new conversation"
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 4v16m8-8H4"
					/>
				</svg>
			</button>
		</div>
	</div>

	{#if showCreate}
		<!-- Create conversation modal / panel -->
		<div class="create-modal-overlay absolute top-16 right-0 left-0 z-50 flex justify-center p-4">
			<div class="create-modal-panel w-full max-w-md rounded-lg p-4">
				<div class="flex items-center gap-2">
					<input
						class="create-modal-input flex-1 rounded px-3 py-2"
						placeholder="Search people by name or email"
						bind:value={searchQuery}
						oninput={() => performSearch(searchQuery)}
					/>
					<button onclick={closeCreate} class="create-modal-close rounded p-2">✕</button>
				</div>
				<div class="mt-3 max-h-64 overflow-y-auto">
					{#if isSearching}
						<div class="search-status text-sm">Searching…</div>
					{:else if searchResults.length === 0}
						<div class="search-status text-sm">No people found</div>
					{:else}
						<ul class="search-results divide-y">
							{#each searchResults as user (user.userId)}
								<li class="p-2">
									<button
										class="search-result-item hover-bg-subtle flex w-full items-center justify-between gap-3 rounded p-2"
										onclick={() => (selectedUser = user)}
									>
										<div class="flex items-center gap-3">
											<div
												class="avatar-circle flex h-8 w-8 items-center justify-center rounded-full"
											>
												{(user.username?.[0] ?? '').toUpperCase()}
											</div>
											<div class="text-left">
												<div class="user-name text-sm font-semibold">
													{user.username}
												</div>
											</div>
										</div>
										{#if selectedUser && selectedUser.userId === user.userId}
											<span class="selected-indicator text-sm">Selected</span>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				<div class="mt-3 flex justify-end gap-2">
					<button onclick={closeCreate} class="cancel-button rounded px-3 py-1">Cancel</button>
					<button
						onclick={confirmCreate}
						class="start-chat-button rounded px-3 py-1 disabled:opacity-50"
						disabled={!selectedUser}
					>
						Start chat
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Conversations List -->
	<div class="flex-1 overflow-y-auto">
		{#if loading}
			<div class="loading-state p-4 text-center">Gathering your correspondence…</div>
		{:else if conversations.length === 0}
			<div class="empty-state p-4 text-center">
				<p class="text-sm">No conversations yet</p>
				<p class="empty-state-hint mt-1 text-xs">Start a new one to begin writing</p>
			</div>
		{:else}
			<ul class="conversations-list divide-y" role="list" aria-label="Conversations">
				{#each conversations as conversation (conversation.userId)}
					<li class="conversation-item" role="listitem">
						<button
							onclick={() => onSelect?.(conversation.userId)}
							aria-label={getConversationAriaLabel(conversation)}
							aria-current={selectedUserId === conversation.userId ? 'true' : 'false'}
							class="conversation-button w-full p-4 text-left focus:outline-none"
							class:selected={selectedUserId === conversation.userId}
						>
							<div class="flex items-start gap-3">
								<!-- Avatar -->
								<div
									class="avatar-circle flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
								>
									{(conversation.username?.[0] ?? '').toUpperCase()}
								</div>

								<!-- Content -->
								<div class="min-w-0 flex-1">
									<div class="mb-1 flex items-center justify-between gap-2">
										<h3 class="conversation-name truncate">
											{conversation.username}
										</h3>
										<span class="conversation-time">
											{formatTime(conversation.lastMessageTime)}
										</span>
									</div>
									<p class="conversation-message truncate text-sm">
										{truncateMessage(conversation.lastMessage, 40)}
									</p>
								</div>

								<!-- Unread Badge -->
								{#if conversation.unreadCount && Number(conversation.unreadCount) > 0}
									<div class="unread-badge flex h-5 w-5 items-center justify-center rounded-full">
										{Number(conversation.unreadCount) > 9 ? '9+' : Number(conversation.unreadCount)}
									</div>
								{/if}
							</div>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.chat-list-container {
		background: var(--bg-primary);
		border-right: 1px solid var(--border-subtle);

		.avatar-circle {
			background: var(--accent-primary);
			color: var(--accent-contrast);
			font-family: var(--font-serif);
			font-weight: 600;
		}

		.user-name {
			color: var(--text-primary);
		}

		.messages-header {
			border-bottom: 1px solid var(--border-subtle);
		}
		.messages-title {
			font-family: var(--font-serif);
			font-size: var(--text-xl);
			font-weight: 600;
			letter-spacing: -0.01em;
			color: var(--text-primary);
		}

		.new-chat-button {
			color: var(--text-secondary);
			transition: all var(--dur-fast) ease;
			background: transparent;
		}
		.new-chat-button:hover {
			background: var(--accent-soft);
			color: var(--accent-primary);
		}

		.create-modal-overlay {
			animation: fadeIn 0.2s ease-out;
		}

		.create-modal-panel {
			background: var(--surface-raised);
			border: 1px solid var(--border-subtle);
			box-shadow: var(--shadow-strong);
			color: var(--text-primary);
		}

		.create-modal-input {
			background: var(--input-bg);
			border: 1px solid var(--input-border);
			color: var(--text-primary);
			transition: all var(--dur-fast) ease;
		}
		.create-modal-input:focus {
			outline: none;
			border-color: var(--accent-primary);
			box-shadow: 0 0 0 3px var(--accent-soft);
		}

		.create-modal-close {
			color: var(--text-secondary);
			transition: all var(--dur-fast) ease;
			background: transparent;
		}
		.create-modal-close:hover {
			background: var(--bg-hover);
		}

		.search-status {
			color: var(--text-secondary);
		}

		.search-results {
			border-color: var(--border-subtle);
		}

		.search-result-item {
			transition: all var(--dur-fast) ease;
			background: transparent;
			color: var(--text-primary);
		}
		.search-result-item:hover {
			background: var(--bg-hover);
		}

		.selected-indicator {
			color: var(--accent-primary);
			font-weight: 600;
		}

		.cancel-button {
			background: transparent;
			border: 1px solid var(--border-strong);
			color: var(--text-secondary);
			transition: all var(--dur-fast) ease;
		}
		.cancel-button:hover {
			background: var(--bg-hover);
			color: var(--text-primary);
		}

		.start-chat-button {
			background: var(--accent-primary);
			color: var(--accent-contrast);
			transition: all var(--dur-fast) ease;
			box-shadow: var(--shadow-cta);
		}
		.start-chat-button:not(:disabled):hover {
			background: var(--accent-secondary);
			transform: translateY(-1px);
		}

		.loading-state {
			color: var(--text-secondary);
			font-family: var(--font-serif);
			font-style: italic;
		}

		.empty-state {
			color: var(--text-secondary);
			animation: fadeIn 0.4s ease-out;
		}
		.empty-state-hint {
			color: var(--text-tertiary);
		}

		.conversations-list {
			border-color: var(--border-subtle);
		}

		.conversation-item {
			animation: fadeIn 0.3s ease-out;
			animation-fill-mode: both;
		}

		.conversation-button {
			transition: background var(--dur-fast) ease;
			background: transparent;
		}
		.conversation-button.selected {
			background: var(--accent-soft);
		}
		.conversation-button:not(.selected):hover {
			background: var(--bg-hover);
		}

		.conversation-name {
			font-family: var(--font-serif);
			font-size: var(--text-md);
			font-weight: 600;
			color: var(--text-primary);
		}
		.conversation-time {
			font-family: var(--font-mono);
			font-size: var(--text-2xs);
			color: var(--text-tertiary);
			flex: none;
		}
		.conversation-message {
			color: var(--text-secondary);
		}

		.unread-badge {
			background: var(--accent-primary);
			color: var(--accent-contrast);
			font-size: var(--text-2xs);
			font-weight: 700;
			animation: scaleIn 0.2s ease-out;
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

	@keyframes scaleIn {
		from {
			transform: scale(0);
		}
		to {
			transform: scale(1);
		}
	}
</style>
