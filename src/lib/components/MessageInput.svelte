<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let disabled = false;
	export let placeholder = 'Type a message...';

	let message = '';
	let textarea: HTMLTextAreaElement;

	const dispatch = createEventDispatcher<{
		send: string;
		typing: boolean;
	}>();

	let typingTimeout: ReturnType<typeof setTimeout>;

	function handleInput() {
		// Auto-resize textarea
		if (textarea) {
			textarea.style.height = 'auto';
			textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
		}

		// Emit typing indicator
		dispatch('typing', true);
		clearTimeout(typingTimeout);
		typingTimeout = setTimeout(() => {
			dispatch('typing', false);
		}, 1000);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSend();
		}
	}

	function handleSend() {
		const trimmedMessage = message.trim();
		if (!trimmedMessage || disabled) return;

		dispatch('send', trimmedMessage);
		message = '';
		
		// Reset textarea height
		if (textarea) {
			textarea.style.height = 'auto';
		}

		dispatch('typing', false);
		clearTimeout(typingTimeout);
	}
</script>

<div class="border-t border-gray-200 bg-white p-4">
	<div class="flex items-end gap-2">
		<div class="flex-1">
			<textarea
				bind:this={textarea}
				bind:value={message}
				oninput={handleInput}
				onkeydown={handleKeydown}
				{disabled}
				{placeholder}
				rows="1"
				class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:opacity-50 disabled:cursor-not-allowed"
			></textarea>
		</div>
		<button
			onclick={handleSend}
			disabled={!message.trim() || disabled}
			class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
		>
			Send
		</button>
	</div>
	<p class="text-xs text-gray-500 mt-2">Press Enter to send, Shift+Enter for new line</p>
</div>
