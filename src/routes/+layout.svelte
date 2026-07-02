<script lang="ts">
	import '../app.css';
	// Self-hosted fonts (CSP font-src 'self'): Spectral (display/serif),
	// Hanken Grotesk (body/sans), Spline Sans Mono (cryptographic metadata).
	import '@fontsource/spectral/400.css';
	import '@fontsource/spectral/500.css';
	import '@fontsource/spectral/600.css';
	import '@fontsource/spectral/700.css';
	import '@fontsource/spectral/400-italic.css';
	import '@fontsource/spectral/500-italic.css';
	import '@fontsource-variable/hanken-grotesk';
	import '@fontsource-variable/spline-sans-mono';
	// Preload the two critical files (body sans + display serif) so first paint
	// doesn't flash fallback type. `?url` resolves to the same hashed asset the
	// @fontsource CSS references, so nothing is fetched twice.
	import hankenGroteskUrl from '@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2?url';
	import spectral600Url from '@fontsource/spectral/files/spectral-latin-600-normal.woff2?url';
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
	<!-- Font preloads: crossorigin is required even same-origin (font fetches are CORS-mode) -->
	<link rel="preload" href={hankenGroteskUrl} as="font" type="font/woff2" crossorigin="anonymous" />
	<link rel="preload" href={spectral600Url} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

{#if showLoading}
	<!-- Auth initialization: unsealing the user's correspondence -->
	<div class="loading-screen">
		<div class="loading-card">
			<span class="wax-seal loading-seal" aria-hidden="true">✦</span>
			<p class="eyebrow">Unsealing your correspondence</p>
		</div>
	</div>
{:else}
	{#if showThemeToggle}
		<ThemeToggle />
	{/if}
	<Toast />

	{@render children?.()}
{/if}

<style>
	.loading-screen {
		display: flex;
		min-height: 100vh;
		align-items: center;
		justify-content: center;
		background: var(--bg-primary);
	}
	.loading-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-md);
	}
	.loading-seal {
		--seal-size: 3.25rem;
		font-size: var(--text-lg);
		animation: sealPulse 1.6s var(--ease-out-quart) infinite;
	}
	@keyframes sealPulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.06);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.loading-seal {
			animation: none;
		}
	}
</style>
