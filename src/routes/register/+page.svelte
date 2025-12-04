<script lang="ts">
	import { authStore } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { logger } from '$lib/services/dev-logger';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { ApiError } from '$lib/types';

	// use Svelte 5 runes for reactive state
	let username = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let showPassword = $state(false);
	let showConfirmPassword = $state(false);
	let loading = $state(false);
	let error = $state('');
	let fieldErrors = $state<Record<string, string>>({});

	// Password validation state for live feedback (derived runes)
	const passwordRequirements = $derived.by(() => ({
		minLength: password.length >= 8,
		hasUpperCase: /[A-Z]/.test(password),
		hasLowerCase: /[a-z]/.test(password),
		hasNumber: /\d/.test(password),
		hasSpecialChar: /[@$!%*?&]/.test(password)
	}));

	const passwordStrength = $derived.by(
		() => Object.values(passwordRequirements).filter(Boolean).length
	);

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

		if (!username || !email || !password || !confirmPassword) {
			error = 'Please fill in all fields';
			return;
		}

		if (password !== confirmPassword) {
			error = 'Passwords do not match';
			fieldErrors = { confirmPassword: 'Passwords do not match' };
			return;
		}

		if (password.length < 8) {
			error = 'Password must be at least 8 characters';
			fieldErrors = { password: 'Password must be at least 8 characters' };
			return;
		}

		// Validate username format: no spaces, 3-30 chars, letters, numbers, _ or -
		const usernameClean = String(username || '')
			.trim()
			.toLowerCase();
		if (/\s/.test(usernameClean)) {
			error = 'Username cannot contain spaces';
			fieldErrors = { username: error };
			return;
		}
		if (!/^[a-z0-9_-]{3,30}$/.test(usernameClean)) {
			error = 'Username invalid. Use 3-30 characters: letters, numbers, _ or -';
			fieldErrors = { username: error };
			return;
		}

		// Validate password complexity to match backend requirements
		const hasUpperCase = /[A-Z]/.test(password);
		const hasLowerCase = /[a-z]/.test(password);
		const hasNumber = /\d/.test(password);
		const hasSpecialChar = /[@$!%*?&]/.test(password);

		if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
			error =
				'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)';
			fieldErrors = { password: error };
			return;
		}

		loading = true;

		try {
			const createdUser = await authStore.register({ username, email, password });

			// E2EE KEY GENERATION & BACKUP: Generate Signal keys and backup encrypted with user's password
			// This ensures:
			// 1. Prekey bundles are available for other users immediately
			// 2. Keys are backed up to server encrypted with user's password
			// 3. Keys can be restored on future logins/devices
			try {
				const { initSignalWithRestore } = await import('$lib/crypto/signal');
				const { cacheEncryptionPassword } = await import('$lib/crypto/keyEncryption');
				const { env } = await import('$env/dynamic/public');

				const userId = createdUser._id;
				let deviceId = localStorage.getItem('deviceId') || '';
				if (!deviceId) {
					deviceId =
						typeof crypto !== 'undefined' && 'randomUUID' in crypto
							? crypto.randomUUID()
							: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
					localStorage.setItem('deviceId', deviceId);
				}

				const apiBase = env.PUBLIC_API_URL || 'http://localhost:80';

				// Initialize Signal with password-based backup
				// This generates keys, publishes prekeys, AND backs up encrypted keys to server
				const success = await initSignalWithRestore(userId, deviceId, apiBase, password);
				if (success) {
					// Cache the password in sessionStorage for key restoration after page refresh
					// This is cleared when the browser tab is closed
					cacheEncryptionPassword(password);
					logger.success('[Registration] Signal Protocol keys generated and backed up');
				} else {
					logger.warning('[Registration] Signal Protocol keys generated without backup');
				}
			} catch (signalError) {
				logger.error('[Registration] Failed to initialize Signal keys:', signalError);
				// Don't block registration - keys will be generated on first chat login
			}

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

<div
	class="animate-fade-in flex min-h-screen items-center justify-center px-4 py-12"
	style="background: var(--bg-primary);"
>
	<div class="w-full max-w-md">
		<!-- Logo/Brand -->
		<div class="mb-10 text-center">
			<div
				class="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
				style="background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);"
			>
				<img
					src="https://res.cloudinary.com/dpqt9h7cn/image/upload/v1764081536/logo_blqxwc.png"
					alt="Chat logo"
					style="width:100%;height:100%;object-fit:cover;display:block;"
				/>
			</div>
			<h2 class="mb-2 text-3xl font-bold" style="color: var(--text-primary);">Create account</h2>
			<p class="text-sm" style="color: var(--text-secondary);">
				Start chatting with your team today
			</p>
		</div>

		<!-- Register Form -->
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
						for="username"
						class="mb-2 block text-sm font-medium"
						style="color: var(--text-secondary);"
					>
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
						style="background: var(--bg-tertiary); border: 1px solid {fieldErrors.username ||
						fieldErrors.name
							? 'var(--color-error)'
							: 'var(--border-subtle)'}; color: var(--text-primary);"
						placeholder="johndoe"
					/>
					<p class="mt-2 text-xs" style="color: var(--text-secondary);">
						Choose a unique username (3–30 characters). Allowed: lowercase letters, numbers,
						underscores (_) and hyphens (-). No spaces allowed.
					</p>
					{#if fieldErrors.username}
						<p class="mt-2 text-sm" style="color: var(--color-error);">
							{fieldErrors.username}
						</p>
					{/if}
				</div>

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
							autocomplete="new-password"
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

					<!-- Password Requirements Helper -->
					{#if password.length > 0}
						<div class="mt-3 space-y-2">
							<div class="flex items-center justify-between">
								<span class="text-xs font-medium" style="color: var(--text-secondary);">
									Password strength
								</span>
								<span
									class="text-xs font-medium"
									style="color: {passwordStrength === 5
										? 'var(--color-success)'
										: passwordStrength >= 3
											? '#f59e0b'
											: 'var(--color-error)'};"
								>
									{passwordStrength === 5 ? 'Strong' : passwordStrength >= 3 ? 'Medium' : 'Weak'}
								</span>
							</div>
							<div class="flex gap-1">
								{#each Array(5) as _, i (i)}
									<div
										class="h-1 flex-1 rounded-full transition-colors duration-200"
										style="background: {i < passwordStrength
											? passwordStrength === 5
												? 'var(--color-success)'
												: passwordStrength >= 3
													? '#f59e0b'
													: 'var(--color-error)'
											: 'var(--border-subtle)'};"
									></div>
								{/each}
							</div>
							<ul class="space-y-1.5 text-xs">
								<li class="flex items-center gap-2">
									<svg
										class="h-4 w-4 shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										style="color: {passwordRequirements.minLength
											? 'var(--color-success)'
											: 'var(--text-tertiary)'};"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d={passwordRequirements.minLength ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'}
										/>
									</svg>
									<span
										style="color: {passwordRequirements.minLength
											? 'var(--text-primary)'
											: 'var(--text-secondary)'};"
									>
										At least 8 characters
									</span>
								</li>
								<li class="flex items-center gap-2">
									<svg
										class="h-4 w-4 shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										style="color: {passwordRequirements.hasUpperCase
											? 'var(--color-success)'
											: 'var(--text-tertiary)'};"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d={passwordRequirements.hasUpperCase
												? 'M5 13l4 4L19 7'
												: 'M6 18L18 6M6 6l12 12'}
										/>
									</svg>
									<span
										style="color: {passwordRequirements.hasUpperCase
											? 'var(--text-primary)'
											: 'var(--text-secondary)'};"
									>
										One uppercase letter (A-Z)
									</span>
								</li>
								<li class="flex items-center gap-2">
									<svg
										class="h-4 w-4 shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										style="color: {passwordRequirements.hasLowerCase
											? 'var(--color-success)'
											: 'var(--text-tertiary)'};"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d={passwordRequirements.hasLowerCase
												? 'M5 13l4 4L19 7'
												: 'M6 18L18 6M6 6l12 12'}
										/>
									</svg>
									<span
										style="color: {passwordRequirements.hasLowerCase
											? 'var(--text-primary)'
											: 'var(--text-secondary)'};"
									>
										One lowercase letter (a-z)
									</span>
								</li>
								<li class="flex items-center gap-2">
									<svg
										class="h-4 w-4 shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										style="color: {passwordRequirements.hasNumber
											? 'var(--color-success)'
											: 'var(--text-tertiary)'};"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d={passwordRequirements.hasNumber ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'}
										/>
									</svg>
									<span
										style="color: {passwordRequirements.hasNumber
											? 'var(--text-primary)'
											: 'var(--text-secondary)'};"
									>
										One number (0-9)
									</span>
								</li>
								<li class="flex items-center gap-2">
									<svg
										class="h-4 w-4 shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										style="color: {passwordRequirements.hasSpecialChar
											? 'var(--color-success)'
											: 'var(--text-tertiary)'};"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d={passwordRequirements.hasSpecialChar
												? 'M5 13l4 4L19 7'
												: 'M6 18L18 6M6 6l12 12'}
										/>
									</svg>
									<span
										style="color: {passwordRequirements.hasSpecialChar
											? 'var(--text-primary)'
											: 'var(--text-secondary)'};"
									>
										One special character (@$!%*?&)
									</span>
								</li>
							</ul>
						</div>
					{/if}

					{#if fieldErrors.password}
						<p class="mt-2 text-sm" style="color: var(--color-error);">{fieldErrors.password}</p>
					{/if}
				</div>

				<div>
					<label
						for="confirmPassword"
						class="mb-2 block text-sm font-medium"
						style="color: var(--text-secondary);"
					>
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
							style="background: var(--bg-tertiary); border: 1px solid {fieldErrors.confirmPassword
								? 'var(--color-error)'
								: 'var(--border-subtle)'}; color: var(--text-primary);"
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
						<p class="mt-2 text-sm" style="color: var(--color-error);">
							{fieldErrors.confirmPassword}
						</p>
					{/if}
				</div>
			</div>

			<button
				type="submit"
				disabled={loading}
				class="btn-primary hover-lift w-full rounded-xl py-3.5 font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{loading ? 'Creating account...' : 'Create account'}
			</button>

			<div class="pt-4 text-center" style="border-top: 1px solid var(--border-subtle);">
				<p class="text-sm" style="color: var(--text-secondary);">
					Already have an account?
					<a
						href="/login"
						class="font-medium transition-colors duration-200"
						style="color: var(--accent-secondary);"
					>
						Sign in
					</a>
				</p>
			</div>
		</form>
	</div>
</div>
