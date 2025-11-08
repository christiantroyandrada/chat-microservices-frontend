<script lang="ts">
	import { authStore } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { ApiError } from '$lib/types';

	let username = '';
	let email = '';
	let password = '';
	let confirmPassword = '';
	let showPassword = false;
	let showConfirmPassword = false;
	let loading = false;
	let error = '';
	let fieldErrors: Record<string, string> = {};

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
		fieldErrors = {};

		if (!username || !email || !password || !confirmPassword) {
			error = 'Please fill in all fields';
			return;
		}

		if (password !== confirmPassword) {
			error = 'Passwords do not match';
			fieldErrors = { confirmPassword: 'Passwords do not match' };
			return;
		}

		if (password.length < 6) {
			error = 'Password must be at least 6 characters';
			fieldErrors = { password: 'Password must be at least 6 characters' };
			return;
		}

		loading = true;

		try {
			await authStore.register({ username, email, password });
			toastStore.success('Registration successful!');
		} catch (err: unknown) {
			const apiError = err as ApiError;
			
			// Handle validation errors from backend
			if (apiError.errors && Array.isArray(apiError.errors)) {
				// Convert array of errors to field-specific errors
				fieldErrors = apiError.errors.reduce((acc: Record<string, string>, error: any) => {
					if (error.field && error.message) {
						acc[error.field] = error.message;
					}
					return acc;
				}, {});
				error = apiError.message || 'Please fix the errors below';
			} else if (apiError.errors && typeof apiError.errors === 'object') {
				// Handle if backend sends errors as object
				fieldErrors = Object.entries(apiError.errors).reduce((acc: Record<string, string>, [field, messages]) => {
					acc[field] = Array.isArray(messages) ? messages[0] : messages as string;
					return acc;
				}, {});
				error = apiError.message || 'Please fix the errors below';
			} else {
				// Generic error message
				const message = apiError.message || 'Registration failed';
				error = message;
			}
			
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Register - Chat App</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
	<div class="w-full max-w-md space-y-8">
		<div class="text-center">
			<h2 class="text-3xl font-bold text-gray-900">Create your account</h2>
			<p class="mt-2 text-sm text-gray-600">
				Already have an account?
				<a href="/login" class="font-medium text-blue-600 hover:text-blue-500"> Sign in </a>
			</p>
		</div>

		<form class="mt-8 space-y-6" on:submit|preventDefault={handleSubmit}>
			{#if error}
				<div class="rounded border border-red-400 bg-red-50 px-4 py-3 text-red-700">
					{error}
				</div>
			{/if}

			<div class="space-y-4">
				<div>
					<label for="username" class="block text-sm font-medium text-gray-700"> Username </label>
					<input
						id="username"
						name="username"
						type="text"
						autocomplete="username"
						required
						bind:value={username}
						class="mt-1 block w-full rounded-md border px-3 py-2 shadow-sm focus:outline-none {fieldErrors.username || fieldErrors.name
							? 'border-red-500 focus:border-red-500 focus:ring-red-500'
							: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'}"
						placeholder="johndoe"
					/>
					{#if fieldErrors.username || fieldErrors.name}
						<p class="mt-1 text-sm text-red-600">{fieldErrors.username || fieldErrors.name}</p>
					{/if}
				</div>

				<div>
					<label for="email" class="block text-sm font-medium text-gray-700"> Email address </label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						bind:value={email}
						class="mt-1 block w-full rounded-md border px-3 py-2 shadow-sm focus:outline-none {fieldErrors.email
							? 'border-red-500 focus:border-red-500 focus:ring-red-500'
							: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'}"
						placeholder="you@example.com"
					/>
					{#if fieldErrors.email}
						<p class="mt-1 text-sm text-red-600">{fieldErrors.email}</p>
					{/if}
				</div>

				<div>
					<label for="password" class="block text-sm font-medium text-gray-700"> Password </label>
					<div class="relative mt-1">
						<input
							id="password"
							name="password"
							type={showPassword ? 'text' : 'password'}
							autocomplete="new-password"
							required
							bind:value={password}
							class="block w-full rounded-md border px-3 py-2 pr-10 shadow-sm focus:outline-none {fieldErrors.password
								? 'border-red-500 focus:border-red-500 focus:ring-red-500'
								: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'}"
							placeholder="••••••••"
						/>
						<button
							type="button"
							on:click={() => (showPassword = !showPassword)}
							class="absolute inset-y-0 right-0 flex items-center pr-2 text-sm leading-5"
							aria-label={showPassword ? 'Hide password' : 'Show password'}
						>
							{#if showPassword}
								<span class="text-gray-600">Hide</span>
							{:else}
								<span class="text-gray-600">Show</span>
							{/if}
						</button>
					</div>
					{#if fieldErrors.password}
						<p class="mt-1 text-sm text-red-600">{fieldErrors.password}</p>
					{/if}
				</div>

				<div>
					<label for="confirmPassword" class="block text-sm font-medium text-gray-700">
						Confirm Password
					</label>
					<div class="relative mt-1">
						<input
							id="confirmPassword"
							name="confirmPassword"
							type={showConfirmPassword ? 'text' : 'password'}
							autocomplete="new-password"
							required
							bind:value={confirmPassword}
							class="block w-full rounded-md border px-3 py-2 pr-10 shadow-sm focus:outline-none {fieldErrors.confirmPassword
								? 'border-red-500 focus:border-red-500 focus:ring-red-500'
								: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'}"
							placeholder="••••••••"
						/>
						<button
							type="button"
							on:click={() => (showConfirmPassword = !showConfirmPassword)}
							class="absolute inset-y-0 right-0 flex items-center pr-2 text-sm leading-5"
							aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
						>
							{#if showConfirmPassword}
								<span class="text-gray-600">Hide</span>
							{:else}
								<span class="text-gray-600">Show</span>
							{/if}
						</button>
					</div>
					{#if fieldErrors.confirmPassword}
						<p class="mt-1 text-sm text-red-600">{fieldErrors.confirmPassword}</p>
					{/if}
				</div>
			</div>

			<div>
				<button
					type="submit"
					disabled={loading}
					class="flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
				>
					{loading ? 'Creating account...' : 'Create account'}
				</button>
			</div>
		</form>
	</div>
</div>
