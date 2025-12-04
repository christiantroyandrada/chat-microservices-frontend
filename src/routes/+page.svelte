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
	<title>Chat App - Loading...</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50">
	<div class="text-center">
		<div class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
		<p class="text-gray-600">Loading...</p>
	</div>
</div>
