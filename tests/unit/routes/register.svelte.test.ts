import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/services/dev-logger', () => ({ logger: { error: vi.fn(), success: vi.fn() } }));
vi.mock('$lib/stores/toast.store', () => ({ toastStore: { success: vi.fn(), error: vi.fn() } }));

vi.mock('$lib/stores/auth.store', () => ({
	authStore: {
		register: vi.fn().mockResolvedValue({ _id: 'u2', username: 'newuser' }),
		subscribe: (fn: (v: unknown) => void) => {
			fn({ user: null });
			return () => {};
		}
	}
}));

import RegisterPage from '../../../src/routes/register/+page.svelte';

describe('register page', () => {
	it('accepts valid input and calls authStore.register', async () => {
		const { container } = render(RegisterPage);

		const username = container.querySelector('input[name="username"]') as HTMLInputElement;
		const email = container.querySelector('input[name="email"]') as HTMLInputElement;
		const password = container.querySelector('input[name="password"]') as HTMLInputElement;
		const confirm = container.querySelector('input[name="confirmPassword"]') as HTMLInputElement;
		const submitBtn = screen.getByRole('button', { name: /Create account/i });

		await fireEvent.input(username, { target: { value: 'new_user' } });
		await fireEvent.input(email, { target: { value: 'new@user.com' } });
		// use a password that satisfies complexity requirements
		const strong = 'Abcd1234!';
		await fireEvent.input(password, { target: { value: strong } });
		await fireEvent.input(confirm, { target: { value: strong } });

		await fireEvent.click(submitBtn);

		const auth = await import('$lib/stores/auth.store');
		expect(auth.authStore.register).toHaveBeenCalled();
	});

	it('renders all required input fields', () => {
		const { container } = render(RegisterPage);

		const usernameInput = container.querySelector('input[name="username"]');
		const emailInput = container.querySelector('input[name="email"]');
		const passwordInput = container.querySelector('input[name="password"]');
		const confirmPasswordInput = container.querySelector('input[name="confirmPassword"]');

		expect(usernameInput).toBeTruthy();
		expect(emailInput).toBeTruthy();
		expect(passwordInput).toBeTruthy();
		expect(confirmPasswordInput).toBeTruthy();
	});

	it('toggles password visibility', async () => {
		const { container } = render(RegisterPage);

		const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;
		const toggleButton = container.querySelector(
			'button[aria-label*="Show password"]'
		) as HTMLButtonElement;

		expect(passwordInput.type).toBe('password');

		await fireEvent.click(toggleButton);
		expect(passwordInput.type).toBe('text');

		await fireEvent.click(toggleButton);
		expect(passwordInput.type).toBe('password');
	});

	it('toggles confirm password visibility', async () => {
		const { container } = render(RegisterPage);

		const confirmInput = container.querySelector(
			'input[name="confirmPassword"]'
		) as HTMLInputElement;
		const toggleButton = container.querySelector(
			'button[aria-label*="Show confirm password"]'
		) as HTMLButtonElement;

		expect(confirmInput.type).toBe('password');

		await fireEvent.click(toggleButton);
		expect(confirmInput.type).toBe('text');

		await fireEvent.click(toggleButton);
		expect(confirmInput.type).toBe('password');
	});

	it('allows typing in all input fields', async () => {
		const { container } = render(RegisterPage);

		const usernameInput = container.querySelector('input[name="username"]') as HTMLInputElement;
		const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
		const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;
		const confirmInput = container.querySelector(
			'input[name="confirmPassword"]'
		) as HTMLInputElement;

		await fireEvent.input(usernameInput, { target: { value: 'testuser' } });
		await fireEvent.input(emailInput, { target: { value: 'test@example.com' } });
		await fireEvent.input(passwordInput, { target: { value: 'TestPass123!' } });
		await fireEvent.input(confirmInput, { target: { value: 'TestPass123!' } });

		expect(usernameInput.value).toBe('testuser');
		expect(emailInput.value).toBe('test@example.com');
		expect(passwordInput.value).toBe('TestPass123!');
		expect(confirmInput.value).toBe('TestPass123!');
	});

	it('renders link to login page', () => {
		const { container } = render(RegisterPage);

		const loginLink = container.querySelector('a[href="/login"]');

		expect(loginLink).toBeTruthy();
		expect(loginLink?.textContent?.trim()).toBe('Sign in');
	});
});
