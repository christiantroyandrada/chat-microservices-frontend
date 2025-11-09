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
		event?.preventDefault();
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
				fieldErrors = apiError.errors.reduce((acc: Record<string, string>, errItem: unknown) => {
					const e = errItem as Record<string, unknown>;
					const field = typeof e.field === 'string' ? e.field : undefined;
					const msg = typeof e.message === 'string' ? e.message : undefined;
					if (field && msg) {
						acc[field] = msg;
					}
					return acc;
				}, {});
				error = apiError.message || 'Please fix the errors below';
			} else if (apiError.errors && typeof apiError.errors === 'object') {
				// Handle if backend sends errors as object
				fieldErrors = Object.entries(apiError.errors).reduce(
					(acc: Record<string, string>, [field, messages]) => {
						acc[field] = Array.isArray(messages) ? messages[0] : (messages as string);
						return acc;
					},
					{}
				);
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

<div class="flex min-h-screen items-center justify-center px-4 py-12 animate-fade-in" style="background: var(--bg-primary);">
	<div class="w-full max-w-md">
		<!-- Logo/Brand -->
		<div class="text-center mb-10">
			<div class="inline-flex h-14 w-14 items-center justify-center rounded-2xl mb-4" style="background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);">
				<svg class="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
				</svg>
			</div>
			<h2 class="text-3xl font-bold mb-2" style="color: var(--text-primary);">Create account</h2>
			<p class="text-sm" style="color: var(--text-secondary);">
				Start chatting with your team today
			</p>
		</div>

		<!-- Register Form -->
		<form class="glass-strong rounded-2xl p-8 space-y-6" style="box-shadow: var(--shadow-medium);" onsubmit={handleSubmit}>
			{#if error}
				<div class="rounded-xl px-4 py-3 animate-slide-in" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444;">
					<div class="flex items-start gap-2">
						<svg class="h-5 w-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<span class="text-sm">{error}</span>
					</div>
				</div>
			{/if}

			<div class="space-y-5">
				<div>
					<label for="username" class="block text-sm font-medium mb-2" style="color: var(--text-secondary);">
						Username
					</label>
					<input
						id="username"
						name="username"
						type="text"
						autocomplete="username"
						required
						bind:value={username}
						class="w-full rounded-xl px-4 py-3 transition-all duration-200"
						style="background: var(--bg-tertiary); border: 1px solid {fieldErrors.username || fieldErrors.name ? '#ef4444' : 'var(--border-subtle)'}; color: var(--text-primary);"
						placeholder="johndoe"
					/>
					{#if fieldErrors.username || fieldErrors.name}
						<p class="mt-2 text-sm" style="color: #ef4444;">{fieldErrors.username || fieldErrors.name}</p>
					{/if}
				</div>

				<div>
					<label for="email" class="block text-sm font-medium mb-2" style="color: var(--text-secondary);">
						Email address
					</label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						bind:value={email}
						class="w-full rounded-xl px-4 py-3 transition-all duration-200"
						style="background: var(--bg-tertiary); border: 1px solid {fieldErrors.email ? '#ef4444' : 'var(--border-subtle)'}; color: var(--text-primary);"
						placeholder="you@example.com"
					/>
					{#if fieldErrors.email}
						<p class="mt-2 text-sm" style="color: #ef4444;">{fieldErrors.email}</p>
					{/if}
				</div>

				<div>
					<label for="password" class="block text-sm font-medium mb-2" style="color: var(--text-secondary);">
						Password
					</label>
					<div class="relative">
						<input
							id="password"
							name="password"
							type={showPassword ? 'text' : 'password'}
							autocomplete="new-password"
							required
							bind:value={password}
							class="w-full rounded-xl px-4 py-3 pr-12 transition-all duration-200"
							style="background: var(--bg-tertiary); border: 1px solid {fieldErrors.password ? '#ef4444' : 'var(--border-subtle)'}; color: var(--text-primary);"
							placeholder="••••••••"
						/>
						<button
							type="button"
							onclick={() => (showPassword = !showPassword)}
							class="absolute inset-y-0 right-0 flex items-center pr-4 transition-colors duration-200"
							style="color: var(--text-tertiary);"
							aria-label={showPassword ? 'Hide password' : 'Show password'}
						>
							<span class="text-sm font-medium">{showPassword ? 'Hide' : 'Show'}</span>
						</button>
					</div>
					{#if fieldErrors.password}
						<p class="mt-2 text-sm" style="color: #ef4444;">{fieldErrors.password}</p>
					{/if}
				</div>

				<div>
					<label for="confirmPassword" class="block text-sm font-medium mb-2" style="color: var(--text-secondary);">
						Confirm Password
					</label>
					<div class="relative">
						<input
							id="confirmPassword"
							name="confirmPassword"
							type={showConfirmPassword ? 'text' : 'password'}
							autocomplete="new-password"
							required
							bind:value={confirmPassword}
							class="w-full rounded-xl px-4 py-3 pr-12 transition-all duration-200"
							style="background: var(--bg-tertiary); border: 1px solid {fieldErrors.confirmPassword ? '#ef4444' : 'var(--border-subtle)'}; color: var(--text-primary);"
							placeholder="••••••••"
						/>
						<button
							type="button"
							onclick={() => (showConfirmPassword = !showConfirmPassword)}
							class="absolute inset-y-0 right-0 flex items-center pr-4 transition-colors duration-200"
							style="color: var(--text-tertiary);"
							aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
						>
							<span class="text-sm font-medium">{showConfirmPassword ? 'Hide' : 'Show'}</span>
						</button>
					</div>
					{#if fieldErrors.confirmPassword}
						<p class="mt-2 text-sm" style="color: #ef4444;">{fieldErrors.confirmPassword}</p>
					{/if}
				</div>
			</div>

			<button
				type="submit"
				disabled={loading}
				class="btn-primary w-full py-3.5 rounded-xl font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 hover-lift"
			>
				{loading ? 'Creating account...' : 'Create account'}
			</button>

			<div class="text-center pt-4" style="border-top: 1px solid var(--border-subtle);">
				<p class="text-sm" style="color: var(--text-secondary);">
					Already have an account?
					<a href="/login" class="font-medium transition-colors duration-200" style="color: var(--accent-secondary);">
						Sign in
					</a>
				</p>
			</div>
		</form>
	</div>
</div>
