<script lang="ts">
	import { authStore } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { logger } from '$lib/services/dev-logger';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { parseApiError } from '$lib/utils/errorHandling';
	import Seal from '$lib/components/Seal.svelte';

	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let loading = $state(false);
	let error = $state('');
	let fieldErrors: Record<string, string> = $state({});

	onMount(() => {
		// Redirect if already authenticated (e.g. user visits /login while logged in).
		// Gated on !loading so the subscriber doesn't navigate mid-login before
		// Signal Protocol init with the password completes — handleSubmit owns navigation.
		const unsubscribe = authStore.subscribe(({ user }) => {
			if (user && !loading) {
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
				const { API_BASE, getOrCreateDeviceId } = await import('$lib/config');

				const userId = loggedInUser._id;
				const deviceId = getOrCreateDeviceId();
				const apiBase = API_BASE;

				// Initialize keys with password-based encryption for backup/restore
				// The password is used to encrypt keys before storing on server
				const success = await initSignalWithRestore(userId, deviceId, apiBase, password);
				if (success) {
					// Keys are now in the persistent IndexedDB store; no password is cached.
					// Refresh/tab-reopen reuses those local keys (no re-derivation needed).
					logger.success('[Login] Signal Protocol keys restored/initialized with backup');
				} else {
					logger.warning('[Login] Signal Protocol initialization completed without backup');
				}
			} catch (signalError) {
				logger.error('[Login] Failed to initialize Signal keys:', signalError);
				// Don't block login - keys will be generated on chat page
			}

			toastStore.success('Login successful!');
			// Navigate AFTER Signal init so the chat page doesn't race with a keyless init
			void goto('/chat');
		} catch (err: unknown) {
			const parsed = parseApiError(err, 'Login failed');
			error = parsed.message;
			fieldErrors = parsed.fieldErrors;
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in · Secret</title>
</svelte:head>

<div class="auth">
	<div class="auth__sheet animate-settle">
		<span class="auth__seal"><Seal size={60} /></span>

		<header class="auth__head">
			<p class="eyebrow">Private correspondence</p>
			<h1>Welcome back</h1>
			<p class="auth__sub">Sign in to pick up where your conversations left off.</p>
		</header>

		<form class="auth__form" onsubmit={handleSubmit} novalidate>
			{#if error}
				<div class="error-box auth__error" role="alert">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<span>{error}</span>
				</div>
			{/if}

			<div class="field">
				<label for="email">Email address</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					bind:value={email}
					class="input"
					class:input--error={fieldErrors.email}
					placeholder="you@example.com"
				/>
				{#if fieldErrors.email}<p class="field__error">{fieldErrors.email}</p>{/if}
			</div>

			<div class="field">
				<label for="password">Password</label>
				<div class="field__wrap">
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						autocomplete="current-password"
						required
						bind:value={password}
						class="input input--withbtn"
						class:input--error={fieldErrors.password}
						placeholder="Your password"
					/>
					<button
						type="button"
						class="reveal"
						onclick={() => (showPassword = !showPassword)}
						aria-label={showPassword ? 'Hide password' : 'Show password'}
					>
						{showPassword ? 'Hide' : 'Show'}
					</button>
				</div>
				{#if fieldErrors.password}<p class="field__error">{fieldErrors.password}</p>{/if}
			</div>

			<button type="submit" class="btn btn-primary auth__submit" disabled={loading}>
				{loading ? 'Unsealing…' : 'Sign in'}
			</button>
		</form>

		<footer class="auth__foot">
			<p class="auth__alt">
				No account yet? <a href="/register">Request one</a>
			</p>
			<p class="auth__note metadata">Every message sealed end-to-end</p>
		</footer>
	</div>
</div>

<style>
	.auth {
		display: flex;
		min-height: 100vh;
		align-items: center;
		justify-content: center;
		padding: var(--space-2xl) var(--space-md);
		background: var(--bg-primary);
	}

	.auth__sheet {
		position: relative;
		width: 100%;
		max-width: 27rem;
		padding: var(--space-2xl) clamp(var(--space-lg), 5vw, var(--space-2xl)) var(--space-xl);
		background: var(--surface-raised);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-strong);
	}

	/* the seal sits on the top edge — as if sealing the letter shut */
	.auth__seal {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translate(-50%, -55%);
		animation: sealStamp 460ms var(--ease-out-quint) both;
	}
	/* stampIn variant carrying the centering translate: keyframe transforms
	   REPLACE the static one (they don't merge), so it must ride every frame */
	@keyframes sealStamp {
		0% {
			opacity: 0;
			transform: translate(-50%, -55%) scale(1.35) rotate(-8deg);
		}
		60% {
			opacity: 1;
		}
		100% {
			opacity: 1;
			transform: translate(-50%, -55%) scale(1) rotate(0deg);
		}
	}

	.auth__head {
		margin-top: var(--space-md);
		margin-bottom: var(--space-xl);
		text-align: center;
	}
	.auth__head h1 {
		font-size: var(--text-2xl);
		margin: var(--space-2xs) 0;
	}
	.auth__sub {
		margin: 0 auto;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}

	.auth__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}
	.field label {
		font-size: var(--text-sm);
		font-weight: 560;
		color: var(--text-secondary);
	}
	.field__wrap {
		position: relative;
	}
	.field__error {
		font-size: var(--text-xs);
		color: var(--color-error);
	}

	.input {
		width: 100%;
		padding: 0.7rem var(--space-md);
		font-size: var(--text-md);
		color: var(--text-primary);
		background: var(--input-bg);
		border: 1px solid var(--input-border);
		border-radius: var(--radius-sm);
		transition:
			border-color var(--dur-fast) ease,
			box-shadow var(--dur-fast) ease;
	}
	.input::placeholder {
		color: var(--text-tertiary);
	}
	.input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.input--withbtn {
		padding-right: 4rem;
	}
	.input--error {
		border-color: var(--color-error);
	}

	.reveal {
		position: absolute;
		inset-inline-end: var(--space-xs);
		top: 50%;
		transform: translateY(-50%);
		padding: 0.35rem var(--space-xs);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-tertiary);
		background: transparent;
		border: 0;
		border-radius: var(--radius-xs);
		cursor: pointer;
	}
	.reveal:hover {
		color: var(--accent-primary);
	}

	.auth__error {
		display: flex;
		align-items: flex-start;
		gap: var(--space-xs);
		padding: var(--space-sm) var(--space-md);
		font-size: var(--text-sm);
	}
	.auth__error svg {
		width: 1.1rem;
		height: 1.1rem;
		flex: none;
		margin-top: 1px;
	}

	.auth__submit {
		width: 100%;
		padding: 0.8rem;
		font-size: var(--text-md);
	}

	.auth__foot {
		margin-top: var(--space-lg);
		padding-top: var(--space-lg);
		border-top: 1px solid var(--border-subtle);
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}
	.auth__alt {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.auth__alt a {
		font-weight: 600;
	}
	.auth__note {
		font-size: var(--text-2xs);
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
	}
</style>
