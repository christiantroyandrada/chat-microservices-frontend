<script lang="ts">
	import type { Message } from '$lib/types';
	import { onMount, tick } from 'svelte';

	// Use Svelte 5 runes props API instead of `export let` in runes mode
	let {
		messages = [] as Message[],
		currentUserId = undefined as string | undefined,
		loading = false,
		conversationId = '' as string
	} = $props();

	let messagesContainer: HTMLDivElement;
	let shouldAutoScroll = true;
	let lastConversationId = '';
	let lastMessageKey: string | null = null;
	let pendingConversationScroll = false;

	$effect(() => {
		conversationId;
		if (conversationId && conversationId !== lastConversationId) {
			lastConversationId = conversationId;
			shouldAutoScroll = true;
			lastMessageKey = null;
			pendingConversationScroll = true;
		}
	});

	$effect(() => {
		messages;
		loading;
		if (!messagesContainer) return;

		if (pendingConversationScroll && !loading) {
			pendingConversationScroll = false;
			const latestKey = messages.length
				? `${messages[messages.length - 1]._id}:${messages.length}`
				: null;
			lastMessageKey = latestKey;

			// Wait for DOM updates and then scroll
			tick().then(() => {
				// Use double RAF to ensure layout is complete
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						scrollToBottom('auto');
					});
				});
			});
			return;
		}

		const currentKey = messages.length
			? `${messages[messages.length - 1]._id}:${messages.length}`
			: null;

		if (currentKey !== lastMessageKey) {
			lastMessageKey = currentKey;
			if (shouldAutoScroll && !loading && currentKey) {
				tick().then(() => scrollToBottom(messages.length > 1 ? 'smooth' : 'auto'));
			}
		}

		if (!messages.length && shouldAutoScroll && !loading) {
			tick().then(() => scrollToBottom('auto'));
		}
	});

	onMount(() => {
		scrollToBottom('auto');
	});

	function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
		if (!messagesContainer) return;

		// Try using scrollTo first (modern approach)
		if (typeof messagesContainer.scrollTo === 'function') {
			messagesContainer.scrollTo({
				top: messagesContainer.scrollHeight,
				behavior
			});
		} else {
			// Fallback for older browsers
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}

		// Additional fallback: if scroll didn't work, try scrollIntoView on last message
		setTimeout(() => {
			if (
				messagesContainer &&
				messagesContainer.scrollTop <
					messagesContainer.scrollHeight - messagesContainer.clientHeight - 50
			) {
				const lastMessage = messagesContainer.querySelector('.flex:last-of-type');
				if (lastMessage && typeof (lastMessage as HTMLElement).scrollIntoView === 'function') {
					(lastMessage as HTMLElement).scrollIntoView({
						behavior,
						block: 'end',
						inline: 'nearest'
					});
				}
			}
		}, 50);
	}

	export async function scrollToLatest(options?: { behavior?: ScrollBehavior }) {
		// Ensure the component has rendered and the browser has laid out the new content
		shouldAutoScroll = true;
		pendingConversationScroll = false;

		// Wait for Svelte to flush DOM updates
		await tick();

		// Wait a couple of animation frames to ensure layout (safer for fonts/images/complex content)
		await new Promise((r) => requestAnimationFrame(() => r(undefined)));
		await new Promise((r) => requestAnimationFrame(() => r(undefined)));

		// Perform the scroll. Default to 'auto' for conversation switches (instant).
		const prevScroll = messagesContainer ? messagesContainer.scrollTop : 0;
		scrollToBottom(options?.behavior ?? 'auto');

		// If the scroll didn't move (some layouts/reporting may not update), fallback to scrollIntoView on the last message element
		try {
			await tick();
			if (messagesContainer && messagesContainer.scrollTop === prevScroll) {
				const lastEl = messagesContainer.querySelector('li:last-child, div:last-child');
				if (lastEl && typeof (lastEl as HTMLElement).scrollIntoView === 'function') {
					(lastEl as HTMLElement).scrollIntoView({
						behavior: options?.behavior ?? 'auto',
						block: 'end'
					});
				}
			}
			console.debug(
				'[MessageList] scrollToLatest performed, behavior=',
				options?.behavior ?? 'auto'
			);
		} catch (e) {
			// ignore errors in environments without console or DOM
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
	class="flex-1 space-y-4 overflow-y-auto p-4 pb-24 md:pb-4"
	style="background: var(--bg-secondary);"
>
	{#if loading}
		<div class="flex h-full items-center justify-center">
			<div style="color: var(--text-secondary); animation: fadeIn 0.3s ease-out;">
				Loading messages...
			</div>
		</div>
	{:else if messages.length === 0}
		<div class="flex h-full items-center justify-center">
			<div
				class="text-center"
				style="color: var(--text-secondary); animation: fadeIn 0.4s ease-out;"
			>
				<p class="mb-2 text-lg">No messages yet</p>
				<p class="text-sm" style="color: var(--text-tertiary);">Start the conversation!</p>
			</div>
		</div>
	{:else}
		{#each messages as message, index (message._id)}
			{#if shouldShowDateSeparator(index)}
				<div class="my-4 flex items-center justify-center" style="animation: fadeIn 0.3s ease-out;">
					<div
						class="rounded-full px-3 py-1 text-xs"
						style="background: rgba(255,255,255,0.05); color: var(--text-tertiary);"
					>
						{formatDate(message.timestamp)}
					</div>
				</div>
			{/if}

			<div
				class="flex {message.senderId === currentUserId ? 'justify-end' : 'justify-start'}"
				style="animation: slideIn{message.senderId === currentUserId
					? 'Right'
					: 'Left'} 0.3s ease-out;"
			>
				<div
					class="max-w-[85%] rounded-lg px-4 py-2 md:max-w-[70%]"
					style={message.senderId === currentUserId
						? 'background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%); color: white;'
						: 'background: rgba(255,255,255,0.05); color: var(--text-primary); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.06);'}
				>
					{#if message.senderId !== currentUserId && message.senderUsername}
						<div class="mb-1 text-xs font-semibold opacity-70">
							{message.senderUsername}
						</div>
					{/if}
					<p class="text-sm wrap-break-word whitespace-pre-wrap">{message.content}</p>
					<div
						class="mt-1 text-xs"
						style={message.senderId === currentUserId
							? 'color: rgba(255,255,255,0.7);'
							: 'color: var(--text-tertiary);'}
					>
						{formatTime(message.timestamp)}
					</div>
				</div>
			</div>
		{/each}
	{/if}
</div>
