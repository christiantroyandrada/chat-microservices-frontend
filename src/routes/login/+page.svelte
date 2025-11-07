<script lang="ts">
	import { authStore } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let email = '';
	let password = '';
	let loading = false;
	let error = '';

	onMount(() => {
		// Redirect if already authenticated
		const unsubscribe = authStore.subscribe(({ user }) => {
			if (user) {
				void goto('/chat');
			}
		});

		return unsubscribe;
	});

	async function handleSubmit() {
		error = '';
		
		if (!email || !password) {
			error = 'Please fill in all fields';
			return;
		}

		loading = true;

		try {
			await authStore.login({ email, password });
			toastStore.success('Login successful!');
		} catch (err: any) {
			error = err.message || 'Login failed';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Login - Chat App</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
	<div class="max-w-md w-full space-y-8">
		<div class="text-center">
			<h2 class="text-3xl font-bold text-gray-900">Sign in to your account</h2>
			<p class="mt-2 text-sm text-gray-600">
				Or
				<a href="/register" class="font-medium text-blue-600 hover:text-blue-500">
					create a new account
				</a>
			</p>
		</div>

		<form class="mt-8 space-y-6" on:submit|preventDefault={handleSubmit}>
			{#if error}
				<div class="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
					{error}
				</div>
			{/if}

			<div class="space-y-4">
				<div>
					<label for="email" class="block text-sm font-medium text-gray-700">
						Email address
					</label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						bind:value={email}
						class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
						placeholder="you@example.com"
					/>
				</div>

				<div>
					<label for="password" class="block text-sm font-medium text-gray-700">
						Password
					</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						required
						bind:value={password}
						class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
						placeholder="••••••••"
					/>
				</div>
			</div>

			<div>
				<button
					type="submit"
					disabled={loading}
					class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{loading ? 'Signing in...' : 'Sign in'}
				</button>
			</div>
		</form>
	</div>
</div>
