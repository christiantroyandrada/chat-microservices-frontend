<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth.store';
	import Toast from '$lib/components/Toast.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();

	onMount(() => {
		// Initialize auth state on app load except for public auth pages
		// (avoid triggering /user/me on /login or /register which will return 401)
		const pathname = get(page).url.pathname;
		if (!pathname.startsWith('/login') && !pathname.startsWith('/register')) {
			void authStore.init();
		}
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
