<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { debounce } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.store';

	// Props in runes mode (accept callback props for events in Svelte 5)
	let {
		disabled = false,
		placeholder = 'Type a message...',
		maxLength = 5000,
		send = null as ((msg: string) => void) | null,
		typing = null as ((isTyping: boolean) => void) | null
	} = $props();

	// Reactive state (runes)
	let message = $state('');
	let textarea: HTMLTextAreaElement;
	let wrapper: HTMLDivElement;

	// Derived UI state stored in $state to be updated by $effect
	let characterCount = $state(0);
	let isNearLimit = $state(false);
	let isOverLimit = $state(false);

	// Use callback props instead of createEventDispatcher in Svelte 5

	let typingTimeout: ReturnType<typeof setTimeout> | undefined;

	// Debounced typing indicator - only fires after user stops typing for 300ms
	const debouncedStopTyping = debounce(() => {
		typing?.(false);
	}, 1000);

	function handleInput() {
		// Auto-resize textarea
		if (textarea) {
			textarea.style.height = 'auto';
			textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
		}

		// Update global CSS var for input height so MessageList can pad accordingly
		updateChatInputHeight();

		// Emit typing indicator immediately when user starts typing via callback prop
		typing?.(true);

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

		send?.(trimmedMessage);
		message = '';

		// Reset textarea height
		if (textarea) {
			textarea.style.height = 'auto';
		}

		// Update input height variable after send
		updateChatInputHeight();

		typing?.(false);
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

	// Keep a CSS variable updated with the actual input wrapper height so MessageList
	// can read it and avoid being overlapped by the fixed input on small screens.
	let _ro: ResizeObserver | null = null;
	function updateChatInputHeight() {
		try {
			const h = wrapper ? wrapper.offsetHeight : 0;
			document.documentElement.style.setProperty('--chat-input-height', `${h}px`);
		} catch {
			// ignore in non-browser environments
		}
	}

	onMount(() => {
		// initial set
		updateChatInputHeight();
		// observe size changes
		if (typeof ResizeObserver !== 'undefined' && wrapper) {
			_ro = new ResizeObserver(() => updateChatInputHeight());
			_ro.observe(wrapper);
		}
		window.addEventListener('resize', updateChatInputHeight);
	});

	onDestroy(() => {
		if (_ro) _ro.disconnect();
		window.removeEventListener('resize', updateChatInputHeight);
	});
</script>

<div
	bind:this={wrapper}
	class="message-input-wrapper fixed right-0 bottom-0 left-0 z-30 p-4 md:static"
>
	<div class="flex items-stretch gap-2">
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
				class="message-input-textarea w-full resize-none rounded-lg px-4 py-2 leading-normal focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
				aria-label="Message input"
				class:error={isOverLimit}
			></textarea>
			{#if isNearLimit}
				<p class="message-input-hint mt-1 text-xs" class:error={isOverLimit}>
					{characterCount}/{maxLength} characters
				</p>
			{/if}
		</div>
		<button
			onclick={handleSend}
			disabled={!message.trim() || disabled || isOverLimit}
			class="send-button flex items-center justify-center rounded-lg px-4 py-2 text-white transition-all disabled:cursor-not-allowed disabled:opacity-50 md:px-6"
			aria-label="Send message"
		>
			<span class="sr-only">Send</span>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" />
			</svg>
		</button>
	</div>
	<p class="message-input-note mt-2 text-xs">Press Enter to send, Shift+Enter for new line</p>
</div>

<style>
	.message-input-wrapper {
		background: var(--bg-primary);
		border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));

		.message-input-textarea {
			background: var(--input-bg);
			border: 1px solid var(--input-border);
			color: var(--input-text);
			transition: all 150ms;

			/* Ensure consistent single-line height with the send button */
			min-height: 100%;
			line-height: 1.2;

			&:focus {
				border-color: var(--accent-primary);
			}

			&.error {
				border-color: var(--color-error);
			}
		}

		.message-input-hint {
			color: var(--text-tertiary);
		}
		.message-input-hint.error {
			color: var(--color-error);
		}

		.send-button {
			background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
			transition:
				transform 120ms ease,
				box-shadow 120ms ease;
			box-shadow: var(--shadow-cta, 0 4px 12px rgba(0, 0, 0, 0.08));

			/* Stretch to match textarea height when it grows */
			height: auto;
			align-self: stretch;
			min-height: 44px;
			min-width: 44px;
			padding-left: 12px;
			padding-right: 12px;
		}
		.send-button:not(:disabled):hover {
			transform: translateY(-2px);
		}

		.message-input-note {
			color: var(--text-tertiary);
		}
	}
</style>
