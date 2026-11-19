import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function signIn(page: Page, origin: URL, username: string, password: string) {
	await page.route(
		(url) => url.origin !== origin.origin,
		(route) => route.abort()
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
			new URL(response.url()).pathname === '/user/prekeys' && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	expect((await prekeys).ok()).toBe(true);
	await expect(page.getByRole('heading', { name: 'Correspondence' })).toBeVisible();
	return id as string;
}

async function startConversation(page: Page, recipient: string) {
	await page.getByRole('button', { name: 'Start new conversation' }).click();
	await page.getByPlaceholder('Search people by name or email').fill(recipient);
	await page.getByRole('button', { name: new RegExp(recipient) }).click();
	await page.getByRole('button', { name: 'Start chat', exact: true }).click();
}

test('Go delivers ciphertext and the open conversation catches up after reconnect', async ({
	browser
}) => {
	const origin = new URL(process.env.FULLSTACK_ORIGIN ?? 'https://127.0.0.1:1');
	const password = `FixtureOnly!${crypto.randomUUID()}`;
	const suffix =
		process.env.FULLSTACK_RUN_ID!.slice(-8) + (process.env.FULLSTACK_ACCOUNT_SUFFIX ?? '');
	const sender = `go_alice_${suffix}`;
	const recipient = `go_bob_${suffix}`;
	const contextA = await browser.newContext({ baseURL: origin.origin, ignoreHTTPSErrors: true });
	const contextB = await browser.newContext({ baseURL: origin.origin, ignoreHTTPSErrors: true });
	try {
		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();
		let senderReady = false;
		const typing: Array<{ userId: string; isTyping: boolean }> = [];
		const presence: Array<{ userId: string; online: boolean | null }> = [];
		const receipts: Array<{ type: string; by: string; messageId?: string }> = [];
		await pageA.routeWebSocket('**/ws/v1*', (client) => {
			client.connectToServer().onMessage((data) => {
				if (typeof data !== 'string') return;
				const frame = JSON.parse(data);
				if (frame.type === 'ready') senderReady = true;
				if (frame.type === 'receipt') receipts.push(frame.data);
				if (frame.type === 'presence') presence.push(frame.data);
				if (frame.type === 'typing') {
					typing.push(frame.data);
					if (frame.data.isTyping === false) return;
				}
				client.send(data);
			});
		});
		const legacyTraffic: string[] = [];
		const observeSocket = (page: Page) =>
			page.on('websocket', (socket) => {
				if (new URL(socket.url()).pathname.startsWith('/chat/socket.io'))
					legacyTraffic.push(socket.url());
			});
		for (const context of [contextA, contextB]) {
			context.on('request', (request) => {
				if (new URL(request.url()).pathname.startsWith('/chat/socket.io'))
					legacyTraffic.push(request.url());
			});
			context.on('page', observeSocket);
		}
		observeSocket(pageA);
		observeSocket(pageB);
		let ready = 0;
		let offline = false;
		let blocked = 0;
		let closeRelay: (() => Promise<void>) | undefined;
		const wire: Array<{ id: string; message: string }> = [];
		await pageB.routeWebSocket('**/ws/v1*', (client) => {
			if (offline) {
				blocked++;
				void client.close({ code: 4000 });
				return;
			}
			const server = client.connectToServer();
			closeRelay = () => server.close({ code: 4000 });
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
		const senderId = await signIn(pageA, origin, sender, password);
		const recipientId = await signIn(pageB, origin, recipient, password);
		await expect.poll(() => [senderReady, ready]).toEqual([true, 1]);
		await startConversation(pageA, recipient);
		await expect.poll(() => presence).toEqual([{ userId: recipientId, online: null }]);
		await expect(pageA.getByText('Presence unavailable', { exact: true })).toBeVisible();

		async function send(text: string) {
			const acceptance = pageA.waitForResponse(
				(response) => new URL(response.url()).pathname === '/chat/send' && response.ok()
			);
			await pageA.getByRole('textbox', { name: 'Message input' }).fill(text);
			await pageA.getByRole('button', { name: 'Seal and send message' }).click();
			return (await (await acceptance).json()).data;
		}
		const acknowledged = pageB.waitForResponse((response) => {
			const path = new URL(response.url()).pathname;
			return (
				/^\/chat\/messages\/[^/]+\/delivered$/.test(path) && response.request().method() === 'PUT'
			);
		});
		const live = await send('Sent over the Go relay');
		const acknowledgement = await acknowledged;
		const deliveryPath = `/chat/messages/${live.id}/delivered`;
		expect(new URL(acknowledgement.url()).pathname).toBe(deliveryPath);
		expect(new URL(acknowledgement.url()).searchParams.get('expectedUserId')).toBe(recipientId);
		expect(acknowledgement.status()).toBe(200);
		await expect.poll(() => wire).toMatchObject([{ id: live.id, message: live.message }]);
		expect(wire[0].message).not.toContain('Sent over the Go relay');
		const sentMessages = pageA.getByRole('log', { name: 'Messages' });
		await expect
			.poll(() => receipts)
			.toContainEqual(
				expect.objectContaining({ type: 'delivered', by: recipientId, messageId: live.id })
			);
		await expect(sentMessages.getByLabel('Delivered', { exact: true })).toHaveCount(1);
		expect(legacyTraffic).toEqual([]);
		expect((await pageB.request.put(deliveryPath)).status()).toBe(400);
		expect(
			(await pageA.request.put(`${deliveryPath}?expectedUserId=${recipientId}`)).status()
		).toBe(403);
		expect((await pageA.request.put(`${deliveryPath}?expectedUserId=${senderId}`)).status()).toBe(
			404
		);
		await pageB.getByRole('button', { name: new RegExp(`Chat with ${sender}`) }).click();
		await expect
			.poll(() => receipts)
			.toContainEqual(expect.objectContaining({ type: 'read', by: recipientId }));
		await expect(sentMessages.getByLabel('Read', { exact: true })).toHaveCount(1);
		const replay = await pageB.request.put(`${deliveryPath}?expectedUserId=${recipientId}`);
		expect(replay.status()).toBe(200);
		expect((await replay.json()).data.modifiedCount).toBe(0);
		expect(
			receipts.filter((receipt) => receipt.type === 'delivered' && receipt.messageId === live.id)
		).toHaveLength(1);
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

		await pageB
			.getByRole('textbox', { name: 'Message input' })
			.fill('A draft stays on this device');
		const indicator = sentMessages
			.getByRole('status')
			.filter({ hasText: `${recipient} is typing` });
		await expect(indicator).toBeAttached();
		await expect
			.poll(() => typing)
			.toEqual([
				{ userId: recipientId, isTyping: true },
				{ userId: recipientId, isTyping: false }
			]);
		await expect(indicator).toHaveCount(0);
		expect(legacyTraffic).toEqual([]);

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

		await test.step('presence follows the first and last Go tab without Socket.IO', async () => {
			const header = pageA.getByRole('heading', { name: recipient, exact: true }).locator('..');
			await expect(header.getByText('Online', { exact: true })).toBeVisible();
			const baseline = presence.length;
			const openRecipientTab = async () => {
				const tab = await contextB.newPage();
				await tab.route(
					(url) => url.origin !== origin.origin,
					(route) => route.abort()
				);
				let tabReady = false;
				await tab.routeWebSocket('**/ws/v1*', (client) => {
					client.connectToServer().onMessage((data) => {
						if (typeof data === 'string' && JSON.parse(data).type === 'ready') tabReady = true;
						client.send(data);
					});
				});
				await tab.goto('/chat');
				await expect.poll(() => tabReady).toBe(true);
				return tab;
			};
			const sibling = await openRecipientTab();
			await pageB.close();
			await expect(header.getByText('Online', { exact: true })).toBeVisible();
			await sibling.close();
			await expect(header.getByText('Offline', { exact: true })).toBeVisible();
			expect(presence.slice(baseline)).toEqual([{ userId: recipientId, online: false }]);
			const reconnected = await openRecipientTab();
			await expect(header.getByText('Online', { exact: true })).toBeVisible();
			expect(presence.slice(baseline)).toEqual([
				{ userId: recipientId, online: false },
				{ userId: recipientId, online: true }
			]);
			await reconnected.getByRole('button', { name: new RegExp(`Chat with ${sender}`) }).click();
			await pageA.getByRole('textbox', { name: 'Message input' }).fill('Go-only draft');
			await expect(
				reconnected
					.getByRole('log', { name: 'Messages' })
					.getByRole('status')
					.filter({ hasText: `${sender} is typing` })
			).toBeAttached();
			await pageA.getByRole('textbox', { name: 'Message input' }).fill('');
			await reconnected.close();
		});
		expect(legacyTraffic).toEqual([]);
	} finally {
		await Promise.all([contextA.close(), contextB.close()]);
	}
});
