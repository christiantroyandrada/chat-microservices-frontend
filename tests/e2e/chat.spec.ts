import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import setupMockBackend, { mockContactOneId, mockContactTwoId } from './mockBackend';

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('Email address').fill('owner@example.com');
	await page.locator('#password').fill('TestPass123!');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/chat$/, { timeout: 15_000 });
	await expect(page.getByRole('heading', { name: 'Correspondence' })).toBeVisible();
}

test.beforeEach(async ({ page, context }) => {
	await context.clearCookies();
	await setupMockBackend(page);
});

test('redirects unauthenticated chat navigation to login', async ({ page }) => {
	await page.goto('/chat');

	await expect(page).toHaveURL(/\/login$/);
});

test('enforces mocked API authentication and conversation membership', async ({
	page,
	context
}) => {
	await page.goto('/login');

	const unauthenticated = await page.evaluate(
		async (contact) =>
			Promise.all([
				fetch('/chat/conversations').then((response) => response.status),
				fetch(`/chat/get/${contact}`).then((response) => response.status),
				fetch(`/chat/messages/read/${contact}`, { method: 'PUT' }).then(
					(response) => response.status
				),
				fetch('/user/search?q=contact').then((response) => response.status)
			]),
		mockContactOneId
	);
	expect(unauthenticated).toEqual([401, 401, 401, 401]);

	await context.addCookies([{ name: 'jwt', value: 'forged-user', url: 'http://localhost:4173' }]);
	const forgedIdentity = await page.evaluate(() =>
		fetch('/chat/conversations').then((response) => response.status)
	);
	expect(forgedIdentity).toBe(401);

	await context.addCookies([
		{ name: 'jwt', value: mockContactTwoId, url: 'http://localhost:4173' }
	]);
	const nonparticipant = await page.evaluate(
		async (contact) =>
			Promise.all([
				fetch(`/chat/get/${contact}`).then((response) => response.status),
				fetch(`/chat/messages/read/${contact}`, { method: 'PUT' }).then(
					(response) => response.status
				)
			]),
		mockContactOneId
	);
	expect(nonparticipant).toEqual([404, 404]);
});

test.describe('Authenticated chat', () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test('renders the seeded conversations', async ({ page }) => {
		await expect(
			page.getByRole('button', { name: 'Chat with E2E Contact One, 2 unread messages' })
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Chat with E2E Contact Two' })).toBeVisible();
	});

	test('searches for a user through the conversation UI', async ({ page }) => {
		await page.getByRole('button', { name: 'New chat', exact: true }).click();
		const search = page.getByPlaceholder('Search people by name or email');
		await expect(search).toBeVisible();
		await search.fill('search user');

		await expect(page.getByRole('button', { name: 'E2E Search User' })).toBeVisible();
	});

	test('keeps the unread count when an opened conversation has no visible messages', async ({
		page
	}) => {
		const unreadConversation = page.getByRole('button', {
			name: 'Chat with E2E Contact One, 2 unread messages'
		});
		await unreadConversation.click();

		await expect(page.getByRole('heading', { name: 'E2E Contact One' })).toBeVisible();
		await expect(page.getByText('No letters here yet')).toBeVisible();
		await page.getByRole('button', { name: 'Back to conversations' }).click();

		await expect(unreadConversation).toBeVisible();
	});
});
