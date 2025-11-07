<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth.store';
	import Toast from '$lib/components/Toast.svelte';

	let { children } = $props();

	onMount(() => {
		// Initialize auth state on app load
		void authStore.init();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<Toast />

{@render children()}
