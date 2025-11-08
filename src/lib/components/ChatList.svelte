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
		currentUserId = null as string | null,
		currentUsername = '' as string,
		onClose = null as (() => void) | null
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

<div class="flex h-full flex-col" style="background: var(--bg-primary); border-right: 1px solid rgba(255,255,255,0.06);">
	<!-- User Info Header -->
	<div class="p-4" style="border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02);">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3" style="animation: fadeIn 0.3s ease-out;">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold text-white"
					style="background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%);"
				>
					{(currentUsername?.[0] ?? 'U').toUpperCase()}
				</div>
				<span class="text-sm font-semibold" style="color: var(--text-primary);">{currentUsername || 'User'}</span>
			</div>
			{#if onClose}
				<button
					onclick={onClose}
					class="inline-flex items-center justify-center rounded-md p-2 lg:hidden"
					style="color: var(--text-secondary); transition: all 150ms; background: transparent;"
					onmouseenter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
					onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
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
	<div class="p-4" style="border-bottom: 1px solid rgba(255,255,255,0.06);">
		<div class="flex items-center justify-between">
			<h2 class="text-xl font-semibold" style="color: var(--text-primary);">Messages</h2>
			<button
				onclick={openCreate}
				class="ml-2 inline-flex items-center justify-center rounded-md p-2"
				style="color: var(--text-secondary); transition: all 150ms; background: transparent;"
				onmouseenter={(e) => (e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
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
		<div class="absolute top-16 right-0 left-0 z-50 flex justify-center p-4" style="animation: fadeIn 0.2s ease-out;">
			<div class="w-full max-w-md rounded-lg p-4 shadow-lg" style="background: rgba(26, 26, 36, 0.98); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1);">
				<div class="flex items-center gap-2">
					<input
						class="flex-1 rounded px-3 py-2"
						style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-primary); transition: all 150ms;"
						onfocus={(e) => (e.currentTarget.style.borderColor = '#6366f1')}
						onblur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
						placeholder="Search users by name or email"
						bind:value={searchQuery}
						oninput={() => performSearch(searchQuery)}
					/>
					<button 
						onclick={closeCreate} 
						class="rounded p-2"
						style="color: var(--text-secondary); transition: all 150ms; background: transparent;"
						onmouseenter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
						onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
					>✕</button>
				</div>
				<div class="mt-3 max-h-64 overflow-y-auto">
					{#if isSearching}
						<div class="text-sm" style="color: var(--text-secondary);">Searching...</div>
					{:else if searchResults.length === 0}
						<div class="text-sm" style="color: var(--text-secondary);">No users found</div>
					{:else}
						<ul class="divide-y" style="border-color: rgba(255,255,255,0.06);">
							{#each searchResults as user (user.userId)}
								<li class="p-2">
									<button
										class="flex w-full items-center justify-between gap-3 rounded p-2"
										style="transition: all 150ms; background: transparent;"
										onmouseenter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
										onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
										onclick={() => (selectedUser = user)}
									>
										<div class="flex items-center gap-3">
											<div
												class="h-8 w-8 flex items-center justify-center rounded-full font-semibold text-white"
												style="background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%);"
											>
												{(user.username?.[0] ?? '').toUpperCase()}
											</div>
											<div class="text-left">
												<div class="text-sm font-semibold" style="color: var(--text-primary);">{user.username}</div>
											</div>
										</div>
										{#if selectedUser && selectedUser.userId === user.userId}
											<span class="text-sm" style="color: #6366f1;">Selected</span>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				<div class="mt-3 flex justify-end gap-2">
					<button 
						onclick={closeCreate} 
						class="rounded px-3 py-1"
						style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-primary); transition: all 150ms;"
						onmouseenter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
						onmouseleave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
					>Cancel</button>
					<button
						onclick={confirmCreate}
						class="rounded px-3 py-1 text-white disabled:opacity-50"
						style="background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%); transition: all 150ms;"
						onmouseenter={(e) => !selectedUser ? null : (e.currentTarget.style.transform = 'translateY(-1px)')}
						onmouseleave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
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
			<div class="p-4 text-center" style="color: var(--text-secondary);">Loading conversations...</div>
		{:else if conversations.length === 0}
			<div class="p-4 text-center" style="color: var(--text-secondary); animation: fadeIn 0.4s ease-out;">
				<p class="text-sm">No conversations yet</p>
				<p class="mt-1 text-xs" style="color: var(--text-tertiary);">Start a new chat to begin messaging</p>
			</div>
		{:else}
			<ul class="divide-y" style="border-color: rgba(255,255,255,0.06);" role="list" aria-label="Conversations">
				{#each conversations as conversation, index (conversation.userId)}
					<li role="listitem" style="animation: fadeIn 0.3s ease-out; animation-delay: {index * 0.05}s; animation-fill-mode: both;">
						<button
							onclick={() => dispatch('select', conversation.userId)}
							aria-label="Chat with {conversation.username}{conversation.unreadCount
								? `, ${conversation.unreadCount} unread messages`
								: ''}"
							aria-current={selectedUserId === conversation.userId ? 'true' : 'false'}
							class="w-full p-4 text-left focus:outline-none"
							style="transition: all 150ms; background: {selectedUserId === conversation.userId ? 'rgba(99, 102, 241, 0.1)' : 'transparent'};"
							onmouseenter={(e) => {
								if (selectedUserId !== conversation.userId) {
									e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
								}
							}}
							onmouseleave={(e) => {
								if (selectedUserId !== conversation.userId) {
									e.currentTarget.style.background = 'transparent';
								}
							}}
						>
							<div class="flex items-start gap-3">
								<!-- Avatar -->
								<div
									class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-semibold text-white"
									style="background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%);"
								>
									{(conversation.username?.[0] ?? '').toUpperCase()}
								</div>

								<!-- Content -->
								<div class="min-w-0 flex-1">
									<div class="mb-1 flex items-center justify-between">
										<h3 class="truncate text-sm font-semibold" style="color: var(--text-primary);">
											{conversation.username}
										</h3>
										<span class="text-xs" style="color: var(--text-tertiary);">
											{formatTime(conversation.lastMessageTime)}
										</span>
									</div>
									<p class="truncate text-sm" style="color: var(--text-secondary);">
										{truncateMessage(conversation.lastMessage, 40)}
									</p>
								</div>

								<!-- Unread Badge -->
								{#if conversation.unreadCount && conversation.unreadCount > 0}
									<div
										class="flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold text-white"
										style="background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%); animation: scaleIn 0.2s ease-out;"
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
