<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth.store';
	import Toast from '$lib/components/Toast.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();

	onMount(() => {
		// Initialize auth state on app load
		void authStore.init();
	});

	// Show theme toggle only on unauthenticated routes (login, register)
	// Hide it on /chat since there's already a toggle in the title bar
	let showThemeToggle = $derived.by(() => !$page.url.pathname.startsWith('/chat'));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if showThemeToggle}
	<ThemeToggle />
{/if}
<Toast />

{@render children()}
