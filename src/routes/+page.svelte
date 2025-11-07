<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/auth.store';

	onMount(() => {
		// Redirect based on auth status
		const unsubscribe = user.subscribe(($user) => {
			if ($user) {
				void goto('/chat');
			} else {
				void goto('/login');
			}
		});

		return unsubscribe;
	});
</script>

<svelte:head>
	<title>Chat App - Loading...</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-50">
	<div class="text-center">
		<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
		<p class="text-gray-600">Loading...</p>
	</div>
</div>

