<script lang="ts">
	import { themeStore } from '$lib/stores/theme.store';

	let theme = $state('dark');

	$effect(() => {
		const unsubscribe = themeStore.subscribe((t) => {
			theme = t;
		});
		return () => unsubscribe();
	});

	function toggleTheme() {
		themeStore.toggle();
	}
</script>

<button
	onclick={toggleTheme}
	class="theme-toggle-button"
	aria-label="Toggle theme"
	title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if theme === 'dark'}
		<!-- Sun icon for light mode -->
		<svg
			class="h-5 w-5"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
			></path>
		</svg>
	{:else}
		<!-- Moon icon for dark mode -->
		<svg
			class="h-5 w-5"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
			></path>
		</svg>
	{/if}
</button>

<style>
	.theme-toggle-button {
		position: fixed;
		top: 1rem;
		right: 1rem;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 1px solid rgba(255, 255, 255, 0.1);
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.theme-toggle-button:hover {
		transform: scale(1.05);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		background: var(--bg-tertiary);
	}

	.theme-toggle-button:active {
		transform: scale(0.95);
	}

	@media (max-width: 768px) {
		.theme-toggle-button {
			width: 2.5rem;
			height: 2.5rem;
		}
	}
</style>
