<script lang="ts">
	import type { ChatConversation } from '$lib/types';
	import { createEventDispatcher } from 'svelte';
	import { chatService } from '$lib/services/chat.service';
	import { debounce } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.store';

	// Props for runes mode
	let {
		conversations = [] as ChatConversation[],
		selectedUserId = null as string | null,
		loading = false,
		currentUserId = null as string | null
	} = $props();

	const dispatch = createEventDispatcher<{
		select: string;
		create: ChatConversation;
	}>();

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
			searchResults = users
				.map((u: any) => ({
					userId: String(u._id ?? u.userId ?? u.id),
					username: u.username ?? u.name ?? 'Unknown',
					lastMessage: undefined,
					lastMessageTime: undefined,
					unreadCount: 0
				}))
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
		// Emit create event with the selected user; parent will handle selecting/creating the thread
		dispatch('create', selectedUser);
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

<div class="flex h-full flex-col border-r border-gray-200 bg-white">
	<!-- Header -->
	<div class="border-b border-gray-200 p-4">
		<div class="flex items-center justify-between">
			<h2 class="text-xl font-semibold text-gray-800">Messages</h2>
			<button
				onclick={openCreate}
				class="ml-2 inline-flex items-center justify-center rounded-md p-2 text-gray-600 hover:bg-gray-100"
				aria-label="Start new conversation"
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
				</svg>
			</button>
		</div>
	</div>

	{#if showCreate}
		<!-- Create conversation modal / panel -->
		<div class="absolute left-0 right-0 top-16 z-50 flex justify-center">
			<div class="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
				<div class="flex items-center gap-2">
					<input
						class="flex-1 rounded border px-3 py-2"
						placeholder="Search users by name or email"
						bind:value={searchQuery}
						oninput={() => performSearch(searchQuery)}
					/>
					<button onclick={closeCreate} class="rounded p-2 text-gray-600 hover:bg-gray-100">✕</button>
				</div>
				<div class="mt-3 max-h-64 overflow-y-auto">
					{#if isSearching}
						<div class="text-sm text-gray-500">Searching...</div>
					{:else if searchResults.length === 0}
						<div class="text-sm text-gray-500">No users found</div>
					{:else}
						<ul class="divide-y">
							{#each searchResults as user}
								<li class="p-2">
									<button
										class="flex w-full items-center justify-between gap-3 rounded p-2 hover:bg-gray-50"
										onclick={() => (selectedUser = user)}
									>
										<div class="flex items-center gap-3">
											<div class="h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-blue-400 to-purple-500 font-semibold text-white">
												{(user.username?.[0] ?? '').toUpperCase()}
											</div>
											<div class="text-left">
												<div class="text-sm font-semibold">{user.username}</div>
											</div>
										</div>
										{#if selectedUser && selectedUser.userId === user.userId}
											<span class="text-sm text-blue-600">Selected</span>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				<div class="mt-3 flex justify-end gap-2">
					<button onclick={closeCreate} class="rounded border px-3 py-1">Cancel</button>
					<button
						onclick={confirmCreate}
						class="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
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
			<div class="p-4 text-center text-gray-500">Loading conversations...</div>
		{:else if conversations.length === 0}
			<div class="p-4 text-center text-gray-500">
				<p class="text-sm">No conversations yet</p>
				<p class="mt-1 text-xs">Start a new chat to begin messaging</p>
			</div>
		{:else}
			<ul class="divide-y divide-gray-200" role="list" aria-label="Conversations">
				{#each conversations as conversation (conversation.userId)}
					<li role="listitem">
						<button
							onclick={() => dispatch('select', conversation.userId)}
							aria-label="Chat with {conversation.username}{conversation.unreadCount
								? `, ${conversation.unreadCount} unread messages`
								: ''}"
							aria-current={selectedUserId === conversation.userId ? 'true' : 'false'}
							class="w-full p-4 text-left transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:outline-none focus:ring-inset {selectedUserId ===
							conversation.userId
								? 'bg-blue-50'
								: ''}"
						>
							<div class="flex items-start gap-3">
								<!-- Avatar -->
								<div
									class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-400 to-purple-500 font-semibold text-white"
								>
									{(conversation.username?.[0] ?? '').toUpperCase()}
								</div>

								<!-- Content -->
								<div class="min-w-0 flex-1">
									<div class="mb-1 flex items-center justify-between">
										<h3 class="truncate text-sm font-semibold text-gray-900">
											{conversation.username}
										</h3>
										<span class="text-xs text-gray-500">
											{formatTime(conversation.lastMessageTime)}
										</span>
									</div>
									<p class="truncate text-sm text-gray-600">
										{truncateMessage(conversation.lastMessage, 40)}
									</p>
								</div>

								<!-- Unread Badge -->
								{#if conversation.unreadCount && conversation.unreadCount > 0}
									<div
										class="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
									>
										{conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
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
