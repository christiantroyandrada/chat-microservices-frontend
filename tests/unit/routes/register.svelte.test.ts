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
});
