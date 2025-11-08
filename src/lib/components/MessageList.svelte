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
	class="flex-1 space-y-4 overflow-y-auto bg-gray-50 p-4"
>
	{#if loading}
		<div class="flex h-full items-center justify-center">
			<div class="text-gray-500">Loading messages...</div>
		</div>
	{:else if messages.length === 0}
		<div class="flex h-full items-center justify-center">
			<div class="text-center text-gray-500">
				<p class="mb-2 text-lg">No messages yet</p>
				<p class="text-sm">Start the conversation!</p>
			</div>
		</div>
	{:else}
		{#each messages as message, index (message._id)}
			{#if shouldShowDateSeparator(index)}
				<div class="my-4 flex items-center justify-center">
					<div class="rounded-full bg-gray-200 px-3 py-1 text-xs text-gray-600">
						{formatDate(message.timestamp)}
					</div>
				</div>
			{/if}

			<div class="flex {message.senderId === currentUserId ? 'justify-end' : 'justify-start'}">
				<div
					class="max-w-[70%] {message.senderId === currentUserId
						? 'bg-blue-600 text-white'
						: 'bg-white text-gray-900'} rounded-lg px-4 py-2 shadow-sm"
				>
					{#if message.senderId !== currentUserId && message.senderUsername}
						<div class="mb-1 text-xs font-semibold opacity-70">
							{message.senderUsername}
						</div>
					{/if}
					<p class="text-sm wrap-break-word whitespace-pre-wrap">{message.content}</p>
					<div
						class="mt-1 text-xs {message.senderId === currentUserId
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
