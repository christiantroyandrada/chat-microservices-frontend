import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, Page } from '@playwright/test';

const origin = process.env.FULLSTACK_ORIGIN!;
const databaseUrl = new URL(process.env.FULLSTACK_DATABASE_URL!);
if (databaseUrl.hostname !== '127.0.0.1' || !databaseUrl.pathname.startsWith('/fullstack_')) {
	throw new Error('The database must belong to the local full-stack fixture');
}
const require = createRequire(
	join(process.env.FULLSTACK_BACKEND_ROOT!, 'user-service/package.json')
);
const { Client } = require('pg');
const password = 'FullstackPass2026!';

test('real Signal delivery preserves commands and account isolation across transport failures', async ({
	browser
}, testInfo) => {
	const database = new Client({ connectionString: databaseUrl.href });
	const contexts: BrowserContext[] = [];
	let primaryFailure: unknown;
	let cleanupFailures: unknown[] = [];
	const external: string[] = [];
	const createContext = async () => {
		const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
		contexts.push(context);
		await context.route('**/*', async (route) => {
			const url = new URL(route.request().url());
			if (url.origin === origin) return route.continue();
			// The application logo is the only permitted external fixture substitution.
			external.push(url.href);
			await route.abort();
		});
		return context;
	};
	const suffix = process.env.FULLSTACK_RUN_ID!.slice(-8);
	const register = async (context: BrowserContext, name: string) => {
		const username = `fixture_${name}_${suffix}`;
		const email = `${username}@example.com`;
		const response = await context.request.post(`${origin}/user/register`, {
			data: { username, email, password }
		});
		expect(response.ok()).toBe(true);
		const account = (await response.json()).data;
		expect(account.id).toMatch(/^[0-9a-f-]{36}$/);
		await context.clearCookies();
		return { id: account.id as string, username, email };
	};
	const login = async (page: Page, email: string, navigate = true) => {
		if (navigate) await page.goto('/login');
		await page.getByLabel('Email address', { exact: true }).fill(email);
		await page.getByLabel('Password', { exact: true }).fill(password);
		const publication = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/user/prekeys' &&
				response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		const published = await publication;
		expect(published.status(), 'Signal prekey publication').toBe(200);
		await expect(page).toHaveURL(`${origin}/chat`);
		await expect(page.getByRole('heading', { name: 'Correspondence' })).toBeVisible();
		return published.headers();
	};
	const cachedMessages = (page: Page, owner: string): Promise<Array<Record<string, unknown>>> =>
		page.evaluate(async (userId) => {
			const name = `chat-messages-${userId}`;
			if (!(await indexedDB.databases()).some((database) => database.name === name)) return [];
			return new Promise((resolve, reject) => {
				const request = indexedDB.open(name);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const transaction = db.transaction('messages', 'readonly');
					const rows = transaction.objectStore('messages').getAll();
					transaction.oncomplete = () => {
						db.close();
						resolve(rows.result);
					};
					transaction.onerror = transaction.onabort = () => {
						db.close();
						reject(transaction.error);
					};
				};
			});
		}, owner);
	try {
		await database.connect();
		const identity = (
			await database.query(
				'SELECT current_database() AS database, system_identifier::text AS system FROM pg_control_system()'
			)
		).rows[0];
		expect(identity.database).toBe(databaseUrl.pathname.slice(1));
		expect(identity.system).toBe(process.env.FULLSTACK_DATABASE_ID);
		const contextA = await createContext();
		const contextB = await createContext();
		const accountA = await register(contextA, 'alice');
		const accountB = await register(contextB, 'bob');
		const accountC = await register(contextB, 'carol');
		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();
		let senderConnections = 0;
		const notificationFrames: string[] = [];
		let interruptSender: (() => Promise<void>) | undefined;
		await pageA.routeWebSocket('**/chat/socket.io/**', (socket) => {
			const server = socket.connectToServer();
			server.onMessage((frame) => {
				if (typeof frame === 'string' && frame.startsWith('40')) senderConnections++;
				socket.send(frame);
			});
			socket.onMessage(async (frame) => {
				if (typeof frame === 'string' && /^42\d*\["sendMessage",/.test(frame)) {
					notificationFrames.push(frame);
					if (notificationFrames.length === 1) {
						// Lose the first notification command after durable REST acceptance.
						interruptSender = async () => {
							await Promise.all([
								socket.close({ code: 1012, reason: 'Fixture transport interruption' }),
								server.close({ code: 1012, reason: 'Fixture transport interruption' })
							]);
						};
						return;
					}
				}
				// Forward Engine.IO heartbeat, Socket.IO handshake, events, and acknowledgements intact.
				server.send(frame);
			});
		});
		let duplicateFrames = 0;
		let recipientConnections = 0;
		await pageB.routeWebSocket('**/chat/socket.io/**', (socket) => {
			const server = socket.connectToServer();
			server.onMessage((frame) => {
				if (typeof frame === 'string' && frame.startsWith('40')) recipientConnections++;
				socket.send(frame);
				if (typeof frame === 'string' && /^42\["receiveMessage",/.test(frame)) {
					duplicateFrames++;
					socket.send(frame);
				}
			});
		});
		await login(pageA, accountA.email);
		await login(pageB, accountB.email);
		await expect.poll(() => [senderConnections, recipientConnections]).toEqual([1, 1]);
		await pageA.getByRole('button', { name: 'Start new conversation' }).click();
		await pageA.getByPlaceholder('Search people by name or email').fill(accountB.username);
		await pageA.getByRole('button', { name: new RegExp(accountB.username) }).click();
		await pageA.getByRole('button', { name: 'Start chat', exact: true }).click();
		const commands: Array<Record<string, string>> = [];
		let acceptedId = '';
		await pageA.route('**/chat/send', async (route) => {
			commands.push(route.request().postDataJSON());
			if (commands.length > 1) return route.continue();
			const accepted = await route.fetch();
			expect(accepted.ok()).toBe(true);
			acceptedId = (await accepted.json()).data.id;
			await route.abort('failed');
		});
		const plaintext = `Local full-stack message ${process.env.FULLSTACK_RUN_ID}`;
		await pageA.getByRole('textbox', { name: 'Message input' }).fill(plaintext);
		await pageA.getByRole('button', { name: 'Seal and send message' }).click();
		const messagesA = pageA.getByRole('log', { name: 'Messages' });
		await expect(messagesA.getByRole('status')).toHaveText('Failed');
		await messagesA.getByRole('button', { name: 'Retry message' }).click();
		await expect.poll(() => commands.length).toBe(2);
		expect(commands[1]).toEqual(commands[0]);
		expect(commands[0]).toMatchObject({ receiverId: accountB.id, expectedSenderId: accountA.id });
		expect(commands[0].clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
		expect(commands[0].message).not.toContain(plaintext);
		await expect(messagesA.getByText(plaintext, { exact: true })).toHaveCount(1);
		await expect(messagesA.getByRole('button', { name: 'Retry message' })).toHaveCount(0);

		await test.step('reconnect replays the accepted notification and duplicates preserve one decrypted message', async () => {
			expect(notificationFrames).toHaveLength(1);
			expect(
				(await cachedMessages(pageA, accountA.id)).filter(
					(message) => message.clientMessageId === commands[0].clientMessageId
				)
			).toMatchObject([{ _id: acceptedId, sendState: 'accepted', pendingNotification: true }]);
			expect(interruptSender).toBeDefined();
			await interruptSender!();
			await expect.poll(() => senderConnections).toBe(2);
			await expect
				.poll(
					async () =>
						(await cachedMessages(pageA, accountA.id)).find((message) => message._id === acceptedId)
							?.pendingNotification
				)
				.toBe(false);
			expect(notificationFrames).toHaveLength(2);
			await expect.poll(() => duplicateFrames).toBeGreaterThan(0);
			await pageB
				.getByRole('button', { name: new RegExp(`Chat with ${accountA.username}`) })
				.click();
			// Socket.IO acknowledgement IDs differ between connections.
			const payload = (frame: string) => JSON.parse(frame.slice(frame.indexOf('[')));
			expect(payload(notificationFrames[1])).toEqual(payload(notificationFrames[0]));
			expect(commands).toHaveLength(2);
			expect(
				(await cachedMessages(pageB, accountB.id)).filter((message) => message._id === acceptedId)
			).toMatchObject([{ content: plaintext }]);
			await expect(messagesA.getByText(plaintext, { exact: true })).toHaveCount(1);
			await expect(
				pageB.getByRole('log', { name: 'Messages' }).getByText(plaintext, { exact: true })
			).toHaveCount(1);
		});

		let records: Record<string, unknown> = {};
		const inspectDatabase = async (notificationCount = 1) => {
			const messages = (
				await database.query(
					'SELECT * FROM messages WHERE "senderId"=$1 AND "clientMessageId"=$2',
					[accountA.id, commands[0].clientMessageId]
				)
			).rows;
			const outbox = (
				await database.query(
					"SELECT * FROM outbox_events WHERE payload->>'senderId'=$1 AND payload->>'userId'=$2 AND payload->>'envelope'=$3",
					[accountA.id, accountB.id, commands[0].message]
				)
			).rows;
			const inbox =
				outbox.length === 1
					? (
							await database.query('SELECT * FROM notification_inbox WHERE "eventKey"=$1', [
								`event:${outbox[0].id}`
							])
						).rows
					: [];
			const notifications = (
				await database.query(
					'SELECT * FROM notifications WHERE "userId"=$1 AND type=$2 AND title=$3',
					[accountB.id, 'message', `New message from ${accountA.username}`]
				)
			).rows;
			records = { messages, outbox, inbox, notifications };
			return (
				messages.length === 1 &&
				messages[0].id === acceptedId &&
				messages[0].message === commands[0].message &&
				outbox.length === 1 &&
				outbox[0].state === 'published' &&
				outbox[0].payload.envelope === commands[0].message &&
				inbox.length === 1 &&
				inbox[0].canonical.envelope === commands[0].message &&
				notifications.length === notificationCount
			);
		};
		await expect.poll(inspectDatabase, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
		const { messages, outbox, inbox } = records as {
			messages: Array<Record<string, string>>;
			outbox: Array<{ id: string; payload: Record<string, string> }>;
			inbox: Array<{ canonical: Record<string, string> }>;
		};
		expect(messages[0].id).toBe(acceptedId);
		expect(messages[0].message).toBe(commands[0].message);
		expect(outbox[0].payload.envelope).toBe(commands[0].message);
		expect(inbox[0].canonical.envelope).toBe(commands[0].message);
		expect(JSON.stringify(records)).not.toContain(plaintext);
		await testInfo.attach('database-evidence', {
			body: JSON.stringify(records, null, 2),
			contentType: 'application/json'
		});
		await Promise.all([pageA.reload(), pageB.reload()]);
		await pageA.getByRole('button', { name: new RegExp(`Chat with ${accountB.username}`) }).click();
		await pageB.getByRole('button', { name: new RegExp(`Chat with ${accountA.username}`) }).click();
		await expect(
			pageA.getByRole('log', { name: 'Messages' }).getByText(plaintext, { exact: true })
		).toHaveCount(1);
		await expect(
			pageB.getByRole('log', { name: 'Messages' }).getByText(plaintext, { exact: true })
		).toHaveCount(1);
		await expect.poll(inspectDatabase, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
		expect(JSON.stringify(records)).not.toContain(plaintext);
		await testInfo.attach('database-evidence-after-reload', {
			body: JSON.stringify(records, null, 2),
			contentType: 'application/json'
		});
		await test.step('shared-cookie changes reject stale sends, reads, and read mutations', async () => {
			await pageB.close();
			await pageA.unroute('**/chat/send');
			const unreadResponse = pageA.waitForResponse(
				(response) => new URL(response.url()).pathname === '/chat/send' && response.ok()
			);
			await pageA
				.getByRole('textbox', { name: 'Message input' })
				.fill('Unread before account change');
			await pageA.getByRole('button', { name: 'Seal and send message' }).click();
			const unread = (await (await unreadResponse).json()).data;
			await expect(pageA.getByRole('log', { name: 'Messages' }).getByRole('status')).toHaveCount(0);
			const sibling = await contextA.newPage();
			await sibling.goto('/chat');
			await sibling.getByRole('button', { name: 'Logout', exact: true }).click();
			await expect(sibling).toHaveURL(`${origin}/login`);
			await login(sibling, accountB.email, false);
			const current = await contextA.request.get(`${origin}/user/me`);
			expect(current.ok()).toBe(true);
			expect((await current.json()).data.id).toBe(accountB.id);
			await expect(pageA).toHaveTitle(`Secret · ${accountA.username}`);

			const before = (await database.query('SELECT * FROM messages WHERE id=$1', [unread.id])).rows;
			expect(before).toHaveLength(1);
			expect(before[0]).toMatchObject({
				senderId: accountA.id,
				receiverId: accountB.id,
				status: 'NotDelivered'
			});
			const staleRequest = pageA.waitForRequest(
				(request) => new URL(request.url()).pathname === '/chat/send' && request.method() === 'POST'
			);
			const staleResponse = pageA.waitForResponse(
				(response) => new URL(response.url()).pathname === '/chat/send' && response.status() === 403
			);
			await pageA.getByRole('textbox', { name: 'Message input' }).fill('Stale account command');
			await pageA.getByRole('button', { name: 'Seal and send message' }).click();
			const rejectedCommand = (await staleRequest).postDataJSON();
			await staleResponse;
			expect(rejectedCommand.expectedSenderId).toBe(accountA.id);
			expect(
				(
					await database.query('SELECT id FROM messages WHERE "clientMessageId"=$1', [
						rejectedCommand.clientMessageId
					])
				).rows
			).toEqual([]);

			const staleStatuses = await pageA.evaluate(
				async ({ sender, owner }) => {
					const paths = [
						['GET', `/chat/get/${sender}`],
						['GET', '/chat/conversations'],
						['PUT', `/chat/messages/read/${sender}`]
					];
					return Promise.all(
						paths.map(
							async ([method, path]) =>
								(await fetch(`${path}?expectedUserId=${owner}`, { method })).status
						)
					);
				},
				{ sender: accountA.id, owner: accountA.id }
			);
			expect(staleStatuses).toEqual([403, 403, 403]);
			expect(
				(await database.query('SELECT * FROM messages WHERE id=$1', [unread.id])).rows
			).toEqual(before);

			await sibling.getByRole('button', { name: 'Logout', exact: true }).click();
			await expect(sibling).toHaveURL(`${origin}/login`);
			await sibling.close();
			await pageA.getByRole('button', { name: 'Logout', exact: true }).click();
			await expect(pageA).toHaveURL(`${origin}/login`);
			const headers = await login(pageA, accountA.email, false);
			const remaining = Number(headers['ratelimit-remaining']);
			expect(remaining).toBeGreaterThanOrEqual(0);
			if (remaining < 2) {
				const reset = Number(headers['ratelimit-reset']);
				expect(reset).toBeGreaterThanOrEqual(0);
				expect(reset).toBeLessThanOrEqual(60);
				// A new account publishes prekeys and a key backup from the same fixture IP.
				await delay((reset + 1) * 1000);
			}
			await pageA
				.getByRole('button', { name: new RegExp(`Chat with ${accountB.username}`) })
				.click();
		});
		await test.step('logout and another account login isolate an accepted in-flight response', async () => {
			let lateCommand: Record<string, string> | undefined;
			let lateId = '';
			let release!: () => void;
			const responseGate = new Promise<void>((resolve) => (release = resolve));
			await pageA.route('**/chat/send', async (route) => {
				lateCommand = route.request().postDataJSON();
				const accepted = await route.fetch();
				expect(accepted.ok()).toBe(true);
				lateId = (await accepted.json()).data.id;
				await responseGate;
				await route.fulfill({ response: accepted });
			});
			const latePlaintext = `Accepted before logout ${process.env.FULLSTACK_RUN_ID}`;
			await pageA.getByRole('textbox', { name: 'Message input' }).fill(latePlaintext);
			await pageA.getByRole('button', { name: 'Seal and send message' }).click();
			await expect.poll(() => lateId).not.toBe('');
			await pageA.getByRole('button', { name: 'Logout', exact: true }).click();
			await expect(pageA).toHaveURL(`${origin}/login`);
			await login(pageA, accountC.email, false);
			await expect(pageA).toHaveTitle(`Secret · ${accountC.username}`);
			expect(await cachedMessages(pageA, accountC.id)).toEqual([]);
			const lateResponse = pageA.waitForResponse(
				(response) => new URL(response.url()).pathname === '/chat/send' && response.ok()
			);
			release();
			await lateResponse;
			await expect
				.poll(
					async () =>
						(await cachedMessages(pageA, accountA.id)).find((message) => message._id === lateId)
							?.sendState
				)
				.toBe('accepted');
			expect(await cachedMessages(pageA, accountC.id)).toEqual([]);
			await expect(pageA.getByText(latePlaintext, { exact: true })).toHaveCount(0);
			await expect(
				pageA.getByRole('button', { name: new RegExp(`Chat with ${accountB.username}`) })
			).toHaveCount(0);
			await pageA.reload();
			await expect(pageA).toHaveTitle(`Secret · ${accountC.username}`);
			expect(await cachedMessages(pageA, accountC.id)).toEqual([]);
			await expect(pageA.getByText(latePlaintext, { exact: true })).toHaveCount(0);

			await expect.poll(() => inspectDatabase(3), { timeout: 30_000 }).toBe(true);
			const lateMessages = (
				await database.query('SELECT * FROM messages WHERE "clientMessageId"=$1', [
					lateCommand!.clientMessageId
				])
			).rows;
			expect(lateMessages).toHaveLength(1);
			expect(lateMessages[0]).toMatchObject({
				id: lateId,
				senderId: accountA.id,
				receiverId: accountB.id,
				message: lateCommand!.message
			});
			const lateEvents = (
				await database.query(
					`SELECT o.*, i."eventKey" FROM outbox_events o
				 JOIN notification_inbox i ON i."eventKey"='event:' || o.id::text
				 WHERE o.payload->>'envelope'=$1 AND o.payload->>'senderId'=$2`,
					[lateCommand!.message, accountA.id]
				)
			).rows;
			expect(lateEvents).toHaveLength(1);
			expect(lateEvents[0].state).toBe('published');
			expect(JSON.stringify({ lateMessages, lateEvents })).not.toContain(latePlaintext);
			await testInfo.attach('database-evidence-after-account-change', {
				body: JSON.stringify({ ...records, lateMessages, lateEvents }, null, 2),
				contentType: 'application/json'
			});
		});
		expect(
			external.every(
				(url) =>
					url === 'https://res.cloudinary.com/dpqt9h7cn/image/upload/v1764081536/logo_blqxwc.png'
			)
		).toBe(true);
	} catch (error) {
		primaryFailure = error;
	} finally {
		const cleanup = await Promise.allSettled(contexts.map((context) => context.close()));
		cleanup.push(...(await Promise.allSettled([database.end()])));
		cleanupFailures = cleanup
			.filter((result) => result.status === 'rejected')
			.map((result) => result.reason);
	}
	if (primaryFailure) throw primaryFailure;
	if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Fixture cleanup failed');
});
