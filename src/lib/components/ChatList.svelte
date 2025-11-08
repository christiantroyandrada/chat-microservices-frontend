<script lang="ts">
	import type { ChatConversation } from '$lib/types';
	import { createEventDispatcher } from 'svelte';

	// Props for runes mode
	let {
		conversations = [] as ChatConversation[],
		selectedUserId = null as string | null,
		loading = false
	} = $props();

	const dispatch = createEventDispatcher<{
		select: string;
	}>();

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
</script>

<div class="flex h-full flex-col border-r border-gray-200 bg-white">
	<!-- Header -->
	<div class="border-b border-gray-200 p-4">
		<h2 class="text-xl font-semibold text-gray-800">Messages</h2>
	</div>

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
										{conversation.lastMessage || 'No messages yet'}
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
