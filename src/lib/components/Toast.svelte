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

	const getColorClasses = (type: string) => {
		switch (type) {
			case 'success':
				return 'bg-green-500 text-white';
			case 'error':
				return 'bg-red-500 text-white';
			case 'warning':
				return 'bg-yellow-500 text-white';
			case 'info':
				return 'bg-blue-500 text-white';
			default:
				return 'bg-gray-800 text-white';
		}
	};
</script>

<div class="fixed top-4 right-4 z-50 flex max-w-md flex-col gap-2">
	{#each toastStore.items as toast (toast.id)}
		<div
			transition:fly={{ y: -20, duration: 300 }}
			class="flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg {getColorClasses(toast.type)}"
		>
			<span class="text-xl font-bold">{getIcon(toast.type)}</span>
			<p class="flex-1 text-sm">{toast.message}</p>
			<button
				onclick={() => toastStore.dismiss(toast.id)}
				class="text-white transition-opacity hover:opacity-80"
				aria-label="Close"
			>
				✕
			</button>
		</div>
	{/each}
</div>
