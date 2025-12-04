<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { authStore, authInitialized } from '$lib/stores/auth.store';
	import Toast from '$lib/components/Toast.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();

	// Track whether we're on a public route that doesn't need auth check
	let isPublicRoute = $derived.by(
		() =>
			page.url.pathname.startsWith('/login') ||
			page.url.pathname.startsWith('/register') ||
			page.url.pathname === '/'
	);

	onMount(() => {
		// Initialize auth state on app load except for public auth pages
		// (avoid triggering /user/me on /login or /register which will return 401)
		const pathname = page.url.pathname;
		if (!pathname.startsWith('/login') && !pathname.startsWith('/register')) {
			void authStore.init();
		}
	});

	// Show theme toggle only on unauthenticated routes (login, register)
	// Hide it on /chat since there's already a toggle in the title bar
	let showThemeToggle = $derived.by(() => !page.url.pathname.startsWith('/chat'));

	// Show loading screen until auth is initialized (except on public routes)
	let showLoading = $derived.by(() => browser && !isPublicRoute && !$authInitialized);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if showLoading}
	<!-- Auth initialization loading screen -->
	<div class="flex min-h-screen items-center justify-center" style="background: var(--bg-primary);">
		<div class="text-center">
			<div
				class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2"
				style="border-color: var(--accent-primary);"
			></div>
			<p style="color: var(--text-secondary);">Loading...</p>
		</div>
	</div>
{:else}
	{#if showThemeToggle}
		<ThemeToggle />
	{/if}
	<Toast />

	{@render children?.()}
{/if}
