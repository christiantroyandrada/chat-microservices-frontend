import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test('Go delivers ciphertext and the open conversation catches up after reconnect', async ({
	browser
}) => {
	const origin = new URL(process.env.FULLSTACK_ORIGIN ?? 'https://127.0.0.1:1');
	const password = `FixtureOnly!${crypto.randomUUID()}`;
	const suffix = process.env.FULLSTACK_RUN_ID!.slice(-8);
	const sender = `go_alice_${suffix}`;
	const recipient = `go_bob_${suffix}`;
	const contextA = await browser.newContext({ baseURL: origin.origin, ignoreHTTPSErrors: true });
	const contextB = await browser.newContext({ baseURL: origin.origin, ignoreHTTPSErrors: true });
	async function signIn(page: Page, username: string) {
		await page.route('**/*', (route) =>
			new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort()
		);
		const email = `${username}@example.com`;
		const registered = await page.request.post('/user/register', {
			data: { username, email, password }
		});
		expect(registered.ok()).toBe(true);
		const { id } = (await registered.json()).data;
		await page.context().clearCookies();
		await page.goto('/login');
		await page.getByLabel('Email address', { exact: true }).fill(email);
		await page.getByLabel('Password', { exact: true }).fill(password);
		const prekeys = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/user/prekeys' &&
				response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		expect((await prekeys).ok()).toBe(true);
		await expect(page.getByRole('heading', { name: 'Correspondence' })).toBeVisible();
		return id as string;
	}
	try {
		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();
		let ready = 0;
		let offline = false;
		let blocked = 0;
		let closeRelay: (() => Promise<void>) | undefined;
		const wire: Array<{ id: string; message: string }> = [];
		await pageB.routeWebSocket('**/ws/v1*', (client) => {
			if (offline) {
				blocked++;
				void client.close({ code: 1012 });
				return;
			}
			const server = client.connectToServer();
			closeRelay = () => server.close({ code: 1012 });
			server.onMessage((data) => {
				if (typeof data !== 'string') return;
				const frame = JSON.parse(data);
				if (frame.type === 'ready') ready++;
				client.send(data);
				if (frame.type === 'message') {
					wire.push(frame.data);
					client.send(data);
				}
			});
		});
		const senderId = await signIn(pageA, sender);
		const recipientId = await signIn(pageB, recipient);
		await expect.poll(() => ready).toBe(1);
		await pageA.getByRole('button', { name: 'Start new conversation' }).click();
		await pageA.getByPlaceholder('Search people by name or email').fill(recipient);
		await pageA.getByRole('button', { name: new RegExp(recipient) }).click();
		await pageA.getByRole('button', { name: 'Start chat', exact: true }).click();

		async function send(text: string) {
			const acceptance = pageA.waitForResponse(
				(response) => new URL(response.url()).pathname === '/chat/send' && response.ok()
			);
			await pageA.getByRole('textbox', { name: 'Message input' }).fill(text);
			await pageA.getByRole('button', { name: 'Seal and send message' }).click();
			return (await (await acceptance).json()).data;
		}
		const live = await send('Sent over the Go relay');
		await expect.poll(() => wire).toMatchObject([{ id: live.id, message: live.message }]);
		expect(wire[0].message).not.toContain('Sent over the Go relay');
		await pageB.getByRole('button', { name: new RegExp(`Chat with ${sender}`) }).click();
		const messages = pageB.getByRole('log', { name: 'Messages' });
		await expect(messages.getByText('Sent over the Go relay', { exact: true })).toHaveCount(1);
		await expect
			.poll(async () => {
				const response = await pageB.request.get(
					`/chat/get/${senderId}?expectedUserId=${recipientId}`
				);
				return (await response.json()).data?.find((row: { id: string }) => row.id === live.id)
					?.status;
			})
			.toBe('Seen');

		offline = true;
		await closeRelay!();
		await expect.poll(() => blocked).toBeGreaterThan(0);
		const missed = await send('Sent while the Go socket was offline');
		const history = await pageB.request.get(`/chat/get/${senderId}?expectedUserId=${recipientId}`);
		expect(history.ok()).toBe(true);
		expect((await history.json()).data).toContainEqual(
			expect.objectContaining({ id: missed.id, message: missed.message, receiverId: recipientId })
		);
		expect(missed.message).not.toContain('Sent while the Go socket was offline');
		await expect(
			messages.getByText('Sent while the Go socket was offline', { exact: true })
		).toHaveCount(0);
		const catchUp = pageB.waitForResponse((response) => {
			const url = new URL(response.url());
			return url.pathname === `/chat/get/${senderId}` && url.searchParams.get('limit') === '50';
		});
		offline = false;
		await expect.poll(() => ready).toBe(2);
		expect((await (await catchUp).json()).data).toContainEqual(
			expect.objectContaining({ id: missed.id, message: missed.message })
		);
		await expect(
			messages.getByText('Sent while the Go socket was offline', { exact: true })
		).toHaveCount(1);
		await expect(messages.getByText('Sent over the Go relay', { exact: true })).toHaveCount(1);
		expect(wire).toHaveLength(1);
	} finally {
		await Promise.all([contextA.close(), contextB.close()]);
	}
});
