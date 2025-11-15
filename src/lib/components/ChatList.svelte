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
		currentUsername = '' as string,
		onClose = null as (() => void) | null,
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
</script>

<div class="chat-list-container flex h-full flex-col">
	<!-- User Info Header -->
	<div class="chat-list-header p-4">
		<div class="flex items-center justify-between">
			<div class="chat-list-user-info flex items-center gap-3">
				<div
					class="avatar-circle flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold text-white"
				>
					{(currentUsername?.[0] ?? 'U').toUpperCase()}
				</div>
				<span class="user-name text-sm font-semibold">{currentUsername || 'User'}</span>
			</div>
			{#if onClose}
				<button
					onclick={onClose}
					class="close-button inline-flex items-center justify-center rounded-md p-2 lg:hidden"
					aria-label="Close sidebar"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			{/if}
		</div>
	</div>

	<!-- Messages Header -->
	<div class="messages-header p-4">
		<div class="flex items-center justify-between">
			<h2 class="messages-title text-xl font-semibold">Messages</h2>
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
			<div class="create-modal-panel w-full max-w-md rounded-lg p-4 shadow-lg">
				<div class="flex items-center gap-2">
					<input
						class="create-modal-input flex-1 rounded px-3 py-2"
						placeholder="Search users by name or email"
						bind:value={searchQuery}
						oninput={() => performSearch(searchQuery)}
					/>
					<button onclick={closeCreate} class="create-modal-close rounded p-2">✕</button>
				</div>
				<div class="mt-3 max-h-64 overflow-y-auto">
					{#if isSearching}
						<div class="search-status text-sm">Searching...</div>
					{:else if searchResults.length === 0}
						<div class="search-status text-sm">No users found</div>
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
												class="avatar-circle flex h-8 w-8 items-center justify-center rounded-full font-semibold text-white"
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
						class="start-chat-button rounded px-3 py-1 text-white disabled:opacity-50"
						disabled={!selectedUser}
					>
						Start Chat
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Conversations List -->
	<div class="flex-1 overflow-y-auto">
		{#if loading}
			<div class="loading-state p-4 text-center">Loading conversations...</div>
		{:else if conversations.length === 0}
			<div class="empty-state p-4 text-center">
				<p class="text-sm">No conversations yet</p>
				<p class="empty-state-hint mt-1 text-xs">Start a new chat to begin messaging</p>
			</div>
		{:else}
			<ul class="conversations-list divide-y" role="list" aria-label="Conversations">
				{#each conversations as conversation (conversation.userId)}
					<li class="conversation-item" role="listitem">
						<button
							onclick={() => onSelect?.(conversation.userId)}
							aria-label="Chat with {conversation.username}{conversation.unreadCount
								? `, ${conversation.unreadCount} unread messages`
								: ''}"
							aria-current={selectedUserId === conversation.userId ? 'true' : 'false'}
							class="conversation-button w-full p-4 text-left focus:outline-none"
							class:selected={selectedUserId === conversation.userId}
						>
							<div class="flex items-start gap-3">
								<!-- Avatar -->
								<div
									class="avatar-circle flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-semibold text-white"
								>
									{(conversation.username?.[0] ?? '').toUpperCase()}
								</div>

								<!-- Content -->
								<div class="min-w-0 flex-1">
									<div class="mb-1 flex items-center justify-between">
										<h3 class="conversation-name truncate text-sm font-semibold">
											{conversation.username}
										</h3>
										<span class="conversation-time text-xs">
											{formatTime(conversation.lastMessageTime)}
										</span>
									</div>
									<p class="conversation-message truncate text-sm">
										{truncateMessage(conversation.lastMessage, 40)}
									</p>
								</div>

								<!-- Unread Badge -->
								{#if conversation.unreadCount && Number(conversation.unreadCount) > 0}
									<div
										class="unread-badge flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold text-white"
									>
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
	/* ChatList component scoped styles (converted to nesting) */
	.chat-list-container {
		background: var(--bg-primary);
		border-right: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));

		.chat-list-user-info {
			animation: fadeIn 0.3s ease-out;
		}

		.avatar-circle {
			background: var(--gradient-accent);
		}

		.user-name {
			color: var(--text-primary);
		}

		.close-button {
			color: var(--text-secondary);
			transition: all 150ms;
			background: transparent;
		}
		.close-button:hover {
			background: var(--bg-hover, rgba(255, 255, 255, 0.05));
		}

		.messages-header {
			border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
		}
		.messages-title {
			color: var(--text-primary);
		}

		.new-chat-button {
			color: var(--text-secondary);
			transition: all 150ms;
			background: transparent;
		}
		.new-chat-button:hover {
			background: var(--accent-hover, rgba(99, 102, 241, 0.1));
		}

		.create-modal-overlay {
			animation: fadeIn 0.2s ease-out;
		}

		.create-modal-panel {
			background: var(--modal-bg);
			backdrop-filter: blur(12px);
			border: 1px solid var(--modal-border);
			color: var(--text-primary);
		}

		.create-modal-input {
			background: var(--bg-tertiary);
			border: 1px solid var(--modal-border);
			color: var(--text-primary);
			transition: all 150ms;
		}
		.create-modal-input:focus {
			border-color: var(--accent-primary);
		}

		.create-modal-close {
			color: var(--text-secondary);
			transition: all 150ms;
			background: transparent;
		}
		.create-modal-close:hover {
			background: var(--bg-hover);
		}

		.search-status {
			color: var(--text-secondary);
		}

		.search-results {
			border-color: var(--modal-border);
		}

		.search-result-item {
			transition: all 150ms;
			background: transparent;
			color: var(--text-primary);
		}
		.search-result-item:hover {
			background: var(--bg-hover);
		}

		.selected-indicator {
			color: var(--accent-primary);
		}

		.cancel-button {
			background: var(--bg-tertiary);
			border: 1px solid var(--modal-border);
			color: var(--text-primary);
			transition: all 150ms;
		}
		.cancel-button:hover {
			background: var(--bg-hover);
		}

		.start-chat-button {
			background: var(--gradient-accent);
			transition: all 150ms;
			box-shadow: var(--shadow-cta);
		}
		.start-chat-button:not(:disabled):hover {
			transform: translateY(-1px);
		}

		.loading-state {
			color: var(--text-secondary);
		}

		.empty-state {
			color: var(--text-secondary);
			animation: fadeIn 0.4s ease-out;
		}
		.empty-state-hint {
			color: var(--text-tertiary);
		}

		.conversations-list {
			border-color: var(--border-subtle, rgba(255, 255, 255, 0.06));
		}

		.conversation-item {
			animation: fadeIn 0.3s ease-out;
			animation-fill-mode: both;
		}

		.conversation-button {
			transition: all 150ms;
			background: transparent;
		}
		.conversation-button.selected {
			background: var(--accent-selected, rgba(99, 102, 241, 0.1));
		}
		.conversation-button:not(.selected):hover {
			background: var(--bg-hover, rgba(255, 255, 255, 0.03));
		}

		.conversation-name {
			color: var(--text-primary);
		}
		.conversation-time {
			color: var(--text-tertiary);
		}
		.conversation-message {
			color: var(--text-secondary);
		}

		.unread-badge {
			background: var(--gradient-accent);
			animation: scaleIn 0.2s ease-out;
		}

		.chat-list-header {
			border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
			background: var(--bg-secondary, rgba(255, 255, 255, 0.02));
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
