<script lang="ts">
	import { authStore } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { logger } from '$lib/services/dev-logger';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { parseApiError } from '$lib/utils/errorHandling';
	import { validatePassword, validateUsername } from '$lib/utils/validation';
	import { getOrCreateDeviceId, API_BASE } from '$lib/config';
	import Seal from '$lib/components/Seal.svelte';

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
	const passwordRequirements = $derived.by(() => {
		const { minLength, hasUpperCase, hasLowerCase, hasNumber, hasSpecialChar } =
			validatePassword(password).requirements;
		return { minLength, hasUpperCase, hasLowerCase, hasNumber, hasSpecialChar };
	});

	const passwordStrength = $derived.by(
		() => Object.values(passwordRequirements).filter(Boolean).length
	);
	const strengthLevel = $derived(
		passwordStrength === 5 ? 'strong' : passwordStrength >= 3 ? 'medium' : 'weak'
	);

	const requirementList = $derived([
		{ met: passwordRequirements.minLength, label: 'At least 8 characters' },
		{ met: passwordRequirements.hasUpperCase, label: 'One uppercase letter (A–Z)' },
		{ met: passwordRequirements.hasLowerCase, label: 'One lowercase letter (a–z)' },
		{ met: passwordRequirements.hasNumber, label: 'One number (0–9)' },
		{ met: passwordRequirements.hasSpecialChar, label: 'One special character (@$!%*?&)' }
	]);

	onMount(() => {
		// Redirect if already authenticated (e.g. user visits /register while logged in).
		// Gated on !loading so the subscriber doesn't navigate mid-registration before
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

		if (!username || !email || !password || !confirmPassword) {
			error = 'Please fill in all fields';
			return;
		}

		if (password !== confirmPassword) {
			error = 'Passwords do not match';
			fieldErrors = { confirmPassword: 'Passwords do not match' };
			return;
		}

		// Validate username format using shared utility (keeps in sync with backend)
		const usernameValidation = validateUsername(username);
		if (!usernameValidation.valid) {
			error = usernameValidation.error!;
			fieldErrors = { username: error };
			return;
		}

		// Validate password complexity using shared utility (keeps in sync with backend)
		const passwordValidation = validatePassword(password);
		if (!passwordValidation.valid) {
			error = passwordValidation.errors[0] ?? 'Password does not meet requirements';
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

				const userId = createdUser._id;
				// getOrCreateDeviceId() uses the namespaced 'chatapp_deviceId' key and
				// migrates any legacy 'deviceId' values, ensuring consistency with login.
				const deviceId = getOrCreateDeviceId();

				const apiBase = API_BASE;

				// Initialize Signal with password-based backup
				// This generates keys, publishes prekeys, AND backs up encrypted keys to server
				const success = await initSignalWithRestore(userId, deviceId, apiBase, password);
				if (success) {
					// Keys are now in the persistent IndexedDB store; no password is cached.
					logger.success('[Registration] Signal Protocol keys generated and backed up');
				} else {
					logger.warning('[Registration] Signal Protocol keys generated without backup');
				}
			} catch (signalError) {
				logger.error('[Registration] Failed to initialize Signal keys:', signalError);
				// Don't block registration - keys will be generated on first chat login
			}

			toastStore.success('Registration successful!');
			// Navigate AFTER Signal init so the chat page doesn't race with a keyless init
			void goto('/chat');
		} catch (err: unknown) {
			const parsed = parseApiError(err, 'Registration failed');
			error = parsed.message;
			fieldErrors = parsed.fieldErrors;
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Open your account · Secret</title>
</svelte:head>

<div class="auth">
	<div class="auth__sheet animate-settle">
		<span class="auth__seal"><Seal size={60} /></span>

		<header class="auth__head">
			<p class="eyebrow">Private correspondence</p>
			<h1>Open your account</h1>
			<p class="auth__sub">A sealed line for your conversations — yours alone.</p>
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
				<label for="username">Username</label>
				<input
					id="username"
					name="username"
					type="text"
					autocomplete="username"
					required
					bind:value={username}
					class="input"
					class:input--error={fieldErrors.username || fieldErrors.name}
					placeholder="johndoe"
				/>
				<p class="field__hint">
					3–30 characters · lowercase letters, numbers, underscore (_) and hyphen (-). No spaces.
				</p>
				{#if fieldErrors.username}<p class="field__error">{fieldErrors.username}</p>{/if}
			</div>

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
						autocomplete="new-password"
						required
						bind:value={password}
						class="input input--withbtn"
						class:input--error={fieldErrors.password}
						placeholder="Choose a strong password"
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

				{#if password.length > 0}
					<div class="pw" data-level={strengthLevel}>
						<div class="pw__head">
							<span class="eyebrow">Strength</span>
							<span class="pw__verdict">
								{strengthLevel === 'strong'
									? 'Strong'
									: strengthLevel === 'medium'
										? 'Fair'
										: 'Weak'}
							</span>
						</div>
						<div class="pw__bars" aria-hidden="true">
							{#each Array(5) as _, i (i)}
								<span class="pw__bar" class:on={i < passwordStrength}></span>
							{/each}
						</div>
						<ul class="req">
							{#each requirementList as r (r.label)}
								<li class:met={r.met}>{r.label}</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if fieldErrors.password}<p class="field__error">{fieldErrors.password}</p>{/if}
			</div>

			<div class="field">
				<label for="confirmPassword">Confirm password</label>
				<div class="field__wrap">
					<input
						id="confirmPassword"
						name="confirmPassword"
						type={showConfirmPassword ? 'text' : 'password'}
						autocomplete="new-password"
						required
						bind:value={confirmPassword}
						class="input input--withbtn"
						class:input--error={fieldErrors.confirmPassword}
						placeholder="Re-enter your password"
					/>
					<button
						type="button"
						class="reveal"
						onclick={() => (showConfirmPassword = !showConfirmPassword)}
						aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
					>
						{showConfirmPassword ? 'Hide' : 'Show'}
					</button>
				</div>
				{#if fieldErrors.confirmPassword}<p class="field__error">
						{fieldErrors.confirmPassword}
					</p>{/if}
			</div>

			<button type="submit" class="btn btn-primary auth__submit" disabled={loading}>
				{loading ? 'Sealing your account…' : 'Create account'}
			</button>
		</form>

		<footer class="auth__foot">
			<p class="auth__alt">Already have an account? <a href="/login">Sign in</a></p>
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
	.field__hint {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		line-height: var(--leading-snug);
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

	/* password strength */
	.pw {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		margin-top: var(--space-2xs);
	}
	.pw__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.pw__verdict {
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.pw[data-level='weak'] .pw__verdict {
		color: var(--color-error);
	}
	.pw[data-level='medium'] .pw__verdict {
		color: var(--color-warning);
	}
	.pw[data-level='strong'] .pw__verdict {
		color: var(--color-success);
	}
	.pw__bars {
		display: flex;
		gap: 4px;
	}
	.pw__bar {
		height: 3px;
		flex: 1;
		border-radius: 99px;
		background: var(--border-subtle);
		transition: background var(--dur-fast) ease;
	}
	.pw[data-level='weak'] .pw__bar.on {
		background: var(--color-error);
	}
	.pw[data-level='medium'] .pw__bar.on {
		background: var(--color-warning);
	}
	.pw[data-level='strong'] .pw__bar.on {
		background: var(--color-success);
	}
	.req {
		list-style: none;
		margin: var(--space-2xs) 0 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
		font-size: var(--text-xs);
	}
	.req li {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		color: var(--text-tertiary);
	}
	.req li::before {
		content: '○';
		font-size: 0.7em;
		color: var(--text-tertiary);
	}
	.req li.met {
		color: var(--text-secondary);
	}
	.req li.met::before {
		content: '✓';
		color: var(--color-success);
		font-size: 0.85em;
	}
</style>
