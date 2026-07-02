<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore, user } from '$lib/stores/auth.store';

	onMount(async () => {
		// First, ensure auth state is initialized from cookie
		await authStore.init();

		// Then redirect based on auth status
		if ($user) {
			void goto('/chat');
		} else {
			void goto('/login');
		}
	});
</script>

<svelte:head>
	<title>Secret · Loading…</title>
</svelte:head>

<!-- Body already carries --bg-primary, so this inherits paper/candlelight correctly -->
<div class="flex min-h-screen items-center justify-center">
	<div class="text-center" role="status">
		<div class="loading-ring mx-auto mb-4 h-12 w-12 animate-spin rounded-full"></div>
		<p style="color: var(--text-tertiary);">Loading…</p>
	</div>
</div>

<style>
	.loading-ring {
		border: 2px solid var(--border-subtle);
		border-bottom-color: var(--accent-primary);
	}
</style>
