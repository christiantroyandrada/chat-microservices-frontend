<script lang="ts">
	import { toastStore } from '$lib/stores/toast.store';
	import { fly } from 'svelte/transition';

	const getIcon = (type: string) => {
		switch (type) {
			case 'success':
				return '✓';
			case 'error':
				return '✕';
			case 'warning':
				return '⚠';
			case 'info':
				return 'ℹ';
			default:
				return '';
		}
	};
</script>

<div class="fixed top-4 right-4 z-50 flex max-w-md flex-col gap-2" aria-live="polite">
	{#each $toastStore as toast (toast.id)}
		<div
			transition:fly={{ y: -20, duration: 300 }}
			class="toast toast--{toast.type} flex items-center gap-3 px-4 py-3"
			role="status"
		>
			<span class="toast__icon text-xl font-bold">{getIcon(toast.type)}</span>
			<p class="flex-1 text-sm">{toast.message}</p>
			<button
				onclick={() => toastStore.dismiss(toast.id)}
				class="toast__close transition-opacity hover:opacity-80"
				aria-label="Close"
			>
				✕
			</button>
		</div>
	{/each}
</div>

<style>
	/* A small paper note: tokenized surface, semantic colour carried by the icon */
	.toast {
		background: var(--surface-raised);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-medium);
		color: var(--text-primary);
	}
	.toast--success .toast__icon {
		color: var(--color-success);
	}
	.toast--error {
		border-color: var(--color-error-border);
	}
	.toast--error .toast__icon {
		color: var(--color-error);
	}
	.toast--warning .toast__icon {
		color: var(--color-warning);
	}
	.toast--info .toast__icon {
		color: var(--color-info);
	}
	.toast__close {
		color: var(--text-tertiary);
	}
</style>
