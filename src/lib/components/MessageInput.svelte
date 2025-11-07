<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { debounce } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.store';

	// Props in runes mode
	let { disabled = false, placeholder = 'Type a message...', maxLength = 5000 } = $props();

	// Reactive state (runes)
	let message = $state('');
	let textarea: HTMLTextAreaElement;

	// Derived UI state stored in $state to be updated by $effect
	let characterCount = $state(0);
	let isNearLimit = $state(false);
	let isOverLimit = $state(false);

	const dispatch = createEventDispatcher<{
		send: string;
		typing: boolean;
	}>();

	let typingTimeout: ReturnType<typeof setTimeout> | undefined;

	// Debounced typing indicator - only fires after user stops typing for 300ms
	const debouncedStopTyping = debounce(() => {
		dispatch('typing', false);
	}, 1000);

	function handleInput() {
		// Auto-resize textarea
		if (textarea) {
			textarea.style.height = 'auto';
			textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
		}

		// Emit typing indicator immediately when user starts typing
		dispatch('typing', true);

		// Reset the stop-typing timer
		debouncedStopTyping();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSend();
		}
	}

	function handleSend() {
		const trimmedMessage = message.trim();

		// Validation checks
		if (!trimmedMessage || disabled) return;

		if (trimmedMessage.length > maxLength) {
			toastStore.error(`Message too long. Maximum ${maxLength} characters allowed.`);
			return;
		}

		// Basic content validation (could be enhanced)
		if (trimmedMessage.length < 1) {
			return;
		}

		dispatch('send', trimmedMessage);
		message = '';

		// Reset textarea height
		if (textarea) {
			textarea.style.height = 'auto';
		}

		dispatch('typing', false);
		if (typingTimeout) {
			clearTimeout(typingTimeout);
		}
	}

	// Update derived values when message or maxLength change
	$effect(() => {
		characterCount = message.length;
		isNearLimit = characterCount > maxLength * 0.8;
		isOverLimit = characterCount > maxLength;
	});
</script>

<div class="fixed right-0 bottom-0 left-0 z-30 border-t border-gray-200 bg-white p-4 md:static">
	<div class="flex items-end gap-2">
		<div class="flex-1">
			<textarea
				bind:this={textarea}
				bind:value={message}
				oninput={handleInput}
				onkeydown={handleKeydown}
				{disabled}
				{placeholder}
				maxlength={maxLength}
				rows="1"
				class="w-full resize-none rounded-lg border px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 {isOverLimit
					? 'border-red-500 focus:ring-red-500'
					: 'border-gray-300'}"
				aria-label="Message input"
			></textarea>
			{#if isNearLimit}
				<p class="mt-1 text-xs {isOverLimit ? 'text-red-600' : 'text-gray-500'}">
					{characterCount}/{maxLength} characters
				</p>
			{/if}
		</div>
		<button
			onclick={handleSend}
			disabled={!message.trim() || disabled || isOverLimit}
			class="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:px-6"
			aria-label="Send message"
		>
			Send
		</button>
	</div>
	<p class="mt-2 text-xs text-gray-500">Press Enter to send, Shift+Enter for new line</p>
</div>
