<script lang="ts">
	import type { ChatConversation } from '$lib/types';
	import { createEventDispatcher } from 'svelte';

	export let conversations: ChatConversation[] = [];
	export let selectedUserId: string | null = null;
	export let loading = false;

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

<div class="flex flex-col h-full bg-white border-r border-gray-200">
	<!-- Header -->
	<div class="p-4 border-b border-gray-200">
		<h2 class="text-xl font-semibold text-gray-800">Messages</h2>
	</div>

	<!-- Conversations List -->
	<div class="flex-1 overflow-y-auto">
		{#if loading}
			<div class="p-4 text-center text-gray-500">Loading conversations...</div>
		{:else if conversations.length === 0}
			<div class="p-4 text-center text-gray-500">
				<p class="text-sm">No conversations yet</p>
				<p class="text-xs mt-1">Start a new chat to begin messaging</p>
			</div>
		{:else}
			<ul class="divide-y divide-gray-200">
				{#each conversations as conversation (conversation.userId)}
					<li>
						<button
							onclick={() => dispatch('select', conversation.userId)}
							class="w-full p-4 hover:bg-gray-50 transition-colors text-left {selectedUserId ===
							conversation.userId
								? 'bg-blue-50'
								: ''}"
						>
							<div class="flex items-start gap-3">
								<!-- Avatar -->
								<div
									class="w-12 h-12 rounded-full bg-linear-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-semibold shrink-0"
								>
									{((conversation.username?.[0] ?? '').toUpperCase())}
								</div>

								<!-- Content -->
								<div class="flex-1 min-w-0">
									<div class="flex items-center justify-between mb-1">
										<h3 class="text-sm font-semibold text-gray-900 truncate">
											{conversation.username}
										</h3>
										<span class="text-xs text-gray-500">
											{formatTime(conversation.lastMessageTime)}
										</span>
									</div>
									<p class="text-sm text-gray-600 truncate">
										{conversation.lastMessage || 'No messages yet'}
									</p>
								</div>

								<!-- Unread Badge -->
								{#if conversation.unreadCount && conversation.unreadCount > 0}
									<div
										class="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-semibold"
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
