<script lang="ts">
	import type { Message } from '$lib/types';
	import { onMount, afterUpdate } from 'svelte';

	export let messages: Message[] = [];
	export let currentUserId: string;
	export let loading = false;

	let messagesContainer: HTMLDivElement;
	let shouldAutoScroll = true;

	onMount(() => {
		scrollToBottom();
	});

	afterUpdate(() => {
		if (shouldAutoScroll) {
			scrollToBottom();
		}
	});

	function scrollToBottom() {
		if (messagesContainer) {
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	}

	function handleScroll() {
		if (!messagesContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
		// Auto-scroll if user is within 100px of bottom
		shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 100;
	}

	function formatTime(timestamp: string): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	function formatDate(timestamp: string): string {
		const date = new Date(timestamp);
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		if (date.toDateString() === today.toDateString()) {
			return 'Today';
		} else if (date.toDateString() === yesterday.toDateString()) {
			return 'Yesterday';
		} else {
			return date.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
			});
		}
	}

	function shouldShowDateSeparator(index: number): boolean {
		if (index === 0) return true;
		const currentDate = new Date(messages[index].timestamp).toDateString();
		const previousDate = new Date(messages[index - 1].timestamp).toDateString();
		return currentDate !== previousDate;
	}
</script>

<div
	bind:this={messagesContainer}
	onscroll={handleScroll}
	class="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50"
>
	{#if loading}
		<div class="flex items-center justify-center h-full">
			<div class="text-gray-500">Loading messages...</div>
		</div>
	{:else if messages.length === 0}
		<div class="flex items-center justify-center h-full">
			<div class="text-center text-gray-500">
				<p class="text-lg mb-2">No messages yet</p>
				<p class="text-sm">Start the conversation!</p>
			</div>
		</div>
	{:else}
		{#each messages as message, index (message._id)}
			{#if shouldShowDateSeparator(index)}
				<div class="flex items-center justify-center my-4">
					<div class="bg-gray-200 text-gray-600 text-xs px-3 py-1 rounded-full">
						{formatDate(message.timestamp)}
					</div>
				</div>
			{/if}

			<div
				class="flex {message.senderId === currentUserId ? 'justify-end' : 'justify-start'}"
			>
				<div
					class="max-w-[70%] {message.senderId === currentUserId
						? 'bg-blue-600 text-white'
						: 'bg-white text-gray-900'} rounded-lg px-4 py-2 shadow-sm"
				>
					{#if message.senderId !== currentUserId && message.senderUsername}
						<div class="text-xs font-semibold mb-1 opacity-70">
							{message.senderUsername}
						</div>
					{/if}
					<p class="text-sm whitespace-pre-wrap wrap-break-word">{message.content}</p>
					<div
						class="text-xs mt-1 {message.senderId === currentUserId
							? 'text-blue-100'
							: 'text-gray-500'}"
					>
						{formatTime(message.timestamp)}
					</div>
				</div>
			</div>
		{/each}
	{/if}
</div>
