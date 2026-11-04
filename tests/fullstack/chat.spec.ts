import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
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

test('real Signal delivery survives a lost REST response and one identical UI retry', async ({
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
	const login = async (page: Page, email: string) => {
		await page.goto('/login');
		await page.getByLabel('Email address', { exact: true }).fill(email);
		await page.getByLabel('Password', { exact: true }).fill(password);
		const publication = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/user/prekeys' &&
				response.request().method() === 'POST' &&
				response.ok()
		);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await publication;
		await expect(page).toHaveURL(`${origin}/chat`);
		await expect(page.getByRole('heading', { name: 'Correspondence' })).toBeVisible();
	};
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
		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();
		await login(pageA, accountA.email);
		await login(pageB, accountB.email);
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
		await pageB.getByRole('button', { name: new RegExp(`Chat with ${accountA.username}`) }).click();
		await expect(
			pageB.getByRole('log', { name: 'Messages' }).getByText(plaintext, { exact: true })
		).toHaveCount(1);
		await expect(messagesA.getByText(plaintext, { exact: true })).toHaveCount(1);
		await expect(messagesA.getByRole('button', { name: 'Retry message' })).toHaveCount(0);

		let records: Record<string, unknown> = {};
		const inspectDatabase = async () => {
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
				notifications.length === 1
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
