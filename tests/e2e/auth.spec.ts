/**
 * E2E tests for authentication flow
 */

import { test, expect } from './test-with-mock';

const BASE_URL = 'http://localhost:4173';

test.describe('Authentication', () => {
	test.beforeEach(async ({ page }) => {
		// Clear cookies and local storage
		await page.context().clearCookies();
		await page.goto(BASE_URL);
	});

	test('should show login page by default', async ({ page }) => {
		await expect(page).toHaveURL(/.*login/);
		await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
	});

	test('should navigate to register page', async ({ page }) => {
		await page.goto(`${BASE_URL}/login`);
		await page.getByRole('link', { name: /create one/i }).click();

		await expect(page).toHaveURL(/.*register/);
		await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible();
	});

	test('should register a new user', async ({ page }) => {
		// Generate a username that matches backend name validation (letters, spaces, hyphens, apostrophes)
		const randAlpha = () =>
			Array.from({ length: 6 }, () =>
				String.fromCharCode(97 + Math.floor(Math.random() * 26))
			).join('');
		const testUser = {
			username: `testuser${randAlpha()}`,
			email: `test${Date.now()}@example.com`,
			password: 'TestPass123!'
		};

		await page.goto(`${BASE_URL}/register`);

		// Fill registration form
		await page.getByLabel(/username/i).fill(testUser.username);
		await page.getByLabel(/email/i).fill(testUser.email);
		await page.locator('#password').fill(testUser.password);
		await page.locator('#confirmPassword').fill(testUser.password);

		// Submit form
		await page.getByRole('button', { name: /create account/i }).click();

		// After submit the app may either show a success toast or automatically
		// redirect to /chat. Accept either behaviour so tests are resilient.
		try {
			await page.getByText(/registration successful/i).waitFor({ state: 'visible', timeout: 5000 });
		} catch {
			// If no toast, the app likely redirected to chat
			await page.waitForURL(/.*chat/, { timeout: 5000 });
		}
	});

	test('should show error for existing email', async ({ page }) => {
		await page.goto(`${BASE_URL}/register`);

		// Try to register with existing email
		await page.getByLabel(/username/i).fill('existinguser');
		await page.getByLabel(/email/i).fill('existing@example.com');
		await page.locator('#password').fill('password123');
		await page.locator('#confirmPassword').fill('password123');

		await page.getByRole('button', { name: /create account/i }).click();

		// Should show error message (try broader patterns)
		await expect(page.getByText(/already|exists|registered|taken/i)).toBeVisible({ timeout: 5000 });
	});

	test('should login with valid credentials', async ({ page }) => {
		// First, create a test user
		const randAlpha = () =>
			Array.from({ length: 6 }, () =>
				String.fromCharCode(97 + Math.floor(Math.random() * 26))
			).join('');
		const testUser = {
			username: `logintest${randAlpha()}`,
			email: `logintest${Date.now()}@example.com`,
			password: 'TestPass123!'
		};

		// Register the user
		await page.goto(`${BASE_URL}/register`);
		await page.getByLabel(/username/i).fill(testUser.username);
		await page.getByLabel(/email/i).fill(testUser.email);
		await page.locator('#password').fill(testUser.password);
		await page.locator('#confirmPassword').fill(testUser.password);
		await page.getByRole('button', { name: /create account/i }).click();

		// After register the app may show a toast or redirect to /chat. Accept either.
		try {
			await page.getByText(/registration successful/i).waitFor({ state: 'visible', timeout: 5000 });
		} catch {
			await page.waitForURL(/.*chat/, { timeout: 5000 });
		}

		// Now login explicitly
		await page.goto(`${BASE_URL}/login`);
		await page.getByLabel(/email/i).fill(testUser.email);
		await page.locator('#password').fill(testUser.password);
		await page.getByRole('button', { name: /sign in/i }).click();

		// Should redirect to chat page after login
		await expect(page).toHaveURL(/.*chat/, { timeout: 10000 });
	});

	test('should show error for invalid credentials', async ({ page }) => {
		await page.goto(`${BASE_URL}/login`);

		// Fill with invalid credentials
		await page.getByLabel(/email/i).fill('nonexistent@example.com');
		await page.locator('#password').fill('wrongpassword123');

		await page.getByRole('button', { name: /sign in/i }).click();

		// Should show error message (check for common error patterns)
		await expect(page.getByText(/invalid|incorrect|failed|not found|wrong/i)).toBeVisible({
			timeout: 5000
		});
	});

	test('should logout successfully', async ({ page }) => {
		// First, create and login a user
		const randAlpha = () =>
			Array.from({ length: 6 }, () =>
				String.fromCharCode(97 + Math.floor(Math.random() * 26))
			).join('');
		const testUser = {
			username: `logouttest${randAlpha()}`,
			email: `logouttest${Date.now()}@example.com`,
			password: 'TestPass123!'
		};

		// Register the user
		await page.goto(`${BASE_URL}/register`);
		await page.getByLabel(/username/i).fill(testUser.username);
		await page.getByLabel(/email/i).fill(testUser.email);
		await page.locator('#password').fill(testUser.password);
		await page.locator('#confirmPassword').fill(testUser.password);
		await page.getByRole('button', { name: /create account/i }).click();

		// After register the app may show a toast or redirect to /chat. Accept either.
		try {
			await page.getByText(/registration successful/i).waitFor({ state: 'visible', timeout: 5000 });
		} catch {
			await page.waitForURL(/.*chat/, { timeout: 5000 });
		}

		// Login
		await page.goto(`${BASE_URL}/login`);
		await page.getByLabel(/email/i).fill(testUser.email);
		await page.locator('#password').fill(testUser.password);
		await page.getByRole('button', { name: /sign in/i }).click();

		// Should redirect to chat page
		await expect(page).toHaveURL(/.*chat/, { timeout: 10000 });

		// Find and click logout button
		await page.getByRole('button', { name: /logout|sign out/i }).click();

		// Should redirect to login page
		await expect(page).toHaveURL(/.*login/, { timeout: 5000 });
	});

	test('should validate required fields', async ({ page }) => {
		await page.goto(`${BASE_URL}/register`);

		// Try to submit without filling fields
		await page.getByRole('button', { name: /create account/i }).click();

		// Should show validation errors
		const usernameInput = page.getByLabel(/username/i);
		const emailInput = page.getByLabel(/email/i);
		const passwordInput = page.locator('#password');

		await expect(usernameInput).toHaveAttribute('required', '');
		await expect(emailInput).toHaveAttribute('required', '');
		await expect(passwordInput).toHaveAttribute('required', '');
	});
});
