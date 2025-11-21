import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/services/dev-logger', () => ({ logger: { error: vi.fn(), success: vi.fn() } }));
vi.mock('$lib/stores/toast.store', () => ({ toastStore: { success: vi.fn(), error: vi.fn() } }));

// Mock authStore factory
vi.mock('$lib/stores/auth.store', () => ({
	authStore: {
		login: vi.fn().mockResolvedValue({ _id: 'u1', username: 'Test' }),
		subscribe: (fn: (v: unknown) => void) => {
			fn({ user: null });
			return () => {};
		}
	}
}));

import LoginPage from '../../../src/routes/login/+page.svelte';

describe('login page', () => {
	it('submits login and shows success', async () => {
		const { container } = render(LoginPage);

		const email = container.querySelector('input[name="email"]') as HTMLInputElement;
		const password = container.querySelector('input[name="password"]') as HTMLInputElement;
		const submitBtn = screen.getByRole('button', { name: /Sign in/i });

		await fireEvent.input(email, { target: { value: 'a@b.com' } });
		await fireEvent.input(password, { target: { value: 'secret' } });
		await fireEvent.click(submitBtn);

		const auth = await import('$lib/stores/auth.store');
		expect(auth.authStore.login).toHaveBeenCalled();
	});

	it('renders email and password inputs', () => {
		const { container } = render(LoginPage);

		const emailInput = container.querySelector('input[name="email"]');
		const passwordInput = container.querySelector('input[name="password"]');

		expect(emailInput).toBeTruthy();
		expect(passwordInput).toBeTruthy();
	});

	it('toggles password visibility', async () => {
		const { container } = render(LoginPage);

		const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;
		const toggleButton = container.querySelector(
			'button[aria-label*="password"]'
		) as HTMLButtonElement;

		expect(passwordInput.type).toBe('password');

		await fireEvent.click(toggleButton);
		expect(passwordInput.type).toBe('text');

		await fireEvent.click(toggleButton);
		expect(passwordInput.type).toBe('password');
	});

	it('allows typing in email input', async () => {
		const { container } = render(LoginPage);

		const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;

		await fireEvent.input(emailInput, { target: { value: 'test@example.com' } });

		expect(emailInput.value).toBe('test@example.com');
	});

	it('allows typing in password input', async () => {
		const { container } = render(LoginPage);

		const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

		await fireEvent.input(passwordInput, { target: { value: 'mypassword' } });

		expect(passwordInput.value).toBe('mypassword');
	});

	it('renders link to registration page', () => {
		const { container } = render(LoginPage);

		const registerLink = container.querySelector('a[href="/register"]');

		expect(registerLink).toBeTruthy();
		expect(registerLink?.textContent?.trim()).toBe('Create one');
	});
});
