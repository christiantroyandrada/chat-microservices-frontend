<script lang="ts">
	import { authStore } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { logger } from '$lib/services/dev-logger';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { ApiError } from '$lib/types';

	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let loading = $state(false);
	let error = $state('');
	let fieldErrors: Record<string, string> = $state({});

	onMount(() => {
		// Redirect if already authenticated
		const unsubscribe = authStore.subscribe(({ user }) => {
			if (user) {
				void goto('/chat');
			}
		});

		return unsubscribe;
	});

	async function handleSubmit(event?: Event) {
		event?.preventDefault();
		error = '';
		fieldErrors = {};

		if (!email || !password) {
			error = 'Please fill in all fields';
			return;
		}

		loading = true;

		try {
			const loggedInUser = await authStore.login({ email, password });

			// E2EE KEY RESTORATION: Use the user's password as the encryption key for Signal Protocol keys
			// This allows keys to be securely backed up to the server and restored on login
			try {
				const { initSignalWithRestore } = await import('$lib/crypto/signal');
				const { cacheEncryptionPassword } = await import('$lib/crypto/keyEncryption');
				const { env } = await import('$env/dynamic/public');

				const userId = loggedInUser._id;
				let deviceId = localStorage.getItem('deviceId') || '';
				if (!deviceId) {
					deviceId =
						typeof crypto !== 'undefined' && 'randomUUID' in crypto
							? crypto.randomUUID()
							: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
					localStorage.setItem('deviceId', deviceId);
				}

				const apiBase = env.PUBLIC_API_URL || 'http://localhost:80';

				// Initialize keys with password-based encryption for backup/restore
				// The password is used to encrypt keys before storing on server
				const success = await initSignalWithRestore(userId, deviceId, apiBase, password);
				if (success) {
					// Cache the password in sessionStorage for key restoration after page refresh
					// This is cleared when the browser tab is closed
					cacheEncryptionPassword(password);
					logger.success('[Login] Signal Protocol keys restored/initialized with backup');
				} else {
					logger.warning('[Login] Signal Protocol initialization completed without backup');
				}
			} catch (signalError) {
				logger.error('[Login] Failed to initialize Signal keys:', signalError);
				// Don't block login - keys will be generated on chat page
			}

			toastStore.success('Login successful!');
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
				const message = apiError.message || 'Login failed';
				error = message;
			}

			toastStore.error(error);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Login - Chat App</title>
</svelte:head>

<div
	class="animate-fade-in flex min-h-screen items-center justify-center px-4 py-12"
	style="background: var(--bg-primary);"
>
	<div class="w-full max-w-md">
		<!-- Logo/Brand -->
		<div class="mb-10 text-center">
			<div
				class="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
				style="background: linear-gradient(135deg, #6366f1, #7c3aed); box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);"
			>
				<img
					src="https://res.cloudinary.com/dpqt9h7cn/image/upload/v1764081536/logo_blqxwc.png"
					alt="Chat logo"
					style="width:100%;height:100%;object-fit:cover;display:block;"
				/>
			</div>
			<h2 class="mb-2 text-3xl font-bold" style="color: var(--text-primary);">Welcome back</h2>
			<p class="text-sm" style="color: var(--text-secondary);">
				Sign in to continue to your conversations
			</p>
		</div>

		<form
			class="glass-strong space-y-6 rounded-2xl p-8"
			style="box-shadow: var(--shadow-medium);"
			onsubmit={handleSubmit}
		>
			{#if error}
				<div
					class="animate-slide-in rounded-xl px-4 py-3"
					style="background: var(--color-error-bg); border: 1px solid var(--color-error-border); color: var(--color-error);"
				>
					<div class="flex items-start gap-2">
						<svg
							class="mt-0.5 h-5 w-5 shrink-0"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span class="text-sm">{error}</span>
					</div>
				</div>
			{/if}

			<div class="space-y-5">
				<div>
					<label
						for="email"
						class="mb-2 block text-sm font-medium"
						style="color: var(--text-secondary);"
					>
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
						style="background: var(--bg-tertiary); border: 1px solid {fieldErrors.email
							? 'var(--color-error)'
							: 'var(--border-subtle)'}; color: var(--text-primary);"
						placeholder="you@example.com"
					/>
					{#if fieldErrors.email}
						<p class="mt-2 text-sm" style="color: var(--color-error);">{fieldErrors.email}</p>
					{/if}
				</div>

				<div>
					<label
						for="password"
						class="mb-2 block text-sm font-medium"
						style="color: var(--text-secondary);"
					>
						Password
					</label>
					<div class="relative">
						<input
							id="password"
							name="password"
							type={showPassword ? 'text' : 'password'}
							autocomplete="current-password"
							required
							bind:value={password}
							class="w-full rounded-xl px-4 py-3 pr-12 transition-all duration-200"
							style="background: var(--bg-tertiary); border: 1px solid {fieldErrors.password
								? 'var(--color-error)'
								: 'var(--border-subtle)'}; color: var(--text-primary);"
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
						<p class="mt-2 text-sm" style="color: var(--color-error);">{fieldErrors.password}</p>
					{/if}
				</div>
			</div>

			<button
				type="submit"
				disabled={loading}
				class="btn-primary hover-lift w-full rounded-xl py-3.5 font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{loading ? 'Signing in...' : 'Sign in'}
			</button>

			<div class="pt-4 text-center" style="border-top: 1px solid var(--border-subtle);">
				<p class="text-sm" style="color: var(--text-secondary);">
					Don't have an account?
					<a
						href="/register"
						class="font-medium transition-colors duration-200"
						style="color: var(--accent-secondary);"
					>
						Create one
					</a>
				</p>
			</div>
		</form>
	</div>
</div>
