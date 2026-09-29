import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import setupMockBackend from './mockBackend';

const seededUser = {
	email: 'owner@example.com',
	password: 'TestPass123!'
};

async function fillRegistration(page: Page, username: string, email: string) {
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Email address').fill(email);
	await page.locator('#password').fill('TestPass123!');
	await page.locator('#confirmPassword').fill('TestPass123!');
}

test.beforeEach(async ({ page, context }) => {
	await context.clearCookies();
	await setupMockBackend(page);
});

test.describe('Authentication', () => {
	test('shows the login page by default', async ({ page }) => {
		await page.goto('/');

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
	});

	test('opens registration from the current login link', async ({ page }) => {
		await page.goto('/login');
		await page.getByRole('link', { name: 'Request one' }).click();

		await expect(page).toHaveURL(/\/register$/);
		await expect(page.getByRole('heading', { name: 'Open your account' })).toBeVisible();
	});

	test('registers a valid user and opens chat', async ({ page }) => {
		await page.goto('/register');
		await fillRegistration(page, 'newuser', 'new@example.com');
		await page.getByRole('button', { name: 'Create account' }).click();

		await expect(page).toHaveURL(/\/chat$/, { timeout: 15_000 });
		await expect(page.getByRole('heading', { name: 'Correspondence' })).toBeVisible();
	});

	test('reports an existing email after otherwise valid registration', async ({ page }) => {
		await page.goto('/register');
		await fillRegistration(page, 'anotheruser', 'existing@example.com');
		await page.getByRole('button', { name: 'Create account' }).click();

		await expect(page.getByRole('alert')).toHaveText('Email already exists');
	});

	test('logs in the seeded user and opens chat', async ({ page }) => {
		await page.goto('/login');
		await page.getByLabel('Email address').fill(seededUser.email);
		await page.locator('#password').fill(seededUser.password);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page).toHaveURL(/\/chat$/, { timeout: 15_000 });
		await expect(page.getByRole('heading', { name: 'Correspondence' })).toBeVisible();
	});

	test('reports invalid credentials in the form alert', async ({ page }) => {
		await page.goto('/login');
		await page.getByLabel('Email address').fill('missing@example.com');
		await page.locator('#password').fill('WrongPass123!');
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page.getByRole('alert')).toHaveText('Invalid credentials');
	});

	test('logs out and clears the authentication cookie', async ({ page, context }) => {
		await page.goto('/login');
		await page.getByLabel('Email address').fill(seededUser.email);
		await page.locator('#password').fill(seededUser.password);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page).toHaveURL(/\/chat$/, { timeout: 15_000 });

		await page.getByRole('button', { name: 'Logout' }).click();

		await expect(page).toHaveURL(/\/login$/);
		expect((await context.cookies()).some((cookie) => cookie.name === 'jwt')).toBe(false);
	});

	test('reports empty registration fields', async ({ page }) => {
		await page.goto('/register');
		await page.getByRole('button', { name: 'Create account' }).click();

		await expect(page.getByRole('alert')).toHaveText('Please fill in all fields');
	});
});
