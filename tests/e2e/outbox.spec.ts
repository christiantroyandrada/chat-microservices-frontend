import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { setupMockBackend, outboxOwnerId, outboxRecipientId } from './mockBackend';

const origin = 'http://127.0.0.1:4174';
let server: ViteDevServer;
test.beforeAll(async () => {
	process.env.PUBLIC_API_URL = origin;
	process.env.PUBLIC_WS_URL = origin;
	server = await createServer({ server: { host: '127.0.0.1', port: 4174, strictPort: true } });
	await server.listen();
});
test.afterAll(async () => {
	await server?.close();
});

test('native reload replays one accepted command without encryption and atomically settles its cache row', async ({
	page,
	context
}) => {
	const state = await setupMockBackend(page, { loseFirstSendResponse: true });
	const prekeyRequests: string[] = [];
	page.on('request', (request) => {
		if (/prekey|signal-keys/.test(request.url())) prekeyRequests.push(request.url());
	});
	await page.route('**/outbox-test', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<html><title>Outbox test</title></html>' })
	);
	await page.addInitScript((base) => {
		Object.assign(globalThis, {
			__sveltekit_dev: { env: { PUBLIC_API_URL: base, PUBLIC_WS_URL: base } }
		});
	}, origin);
	await context.addCookies([{ name: 'jwt', value: outboxOwnerId, url: origin }]);
	await page.goto(origin + '/outbox-test');
	const command = await page.evaluate(
		async ({ owner, receiver }) => {
			const modulePath = '/src/lib/crypto/messageStore.ts';
			const { getMessageStore } = await import(/* @vite-ignore */ modulePath);
			const id = crypto.randomUUID();
			const message = {
				_id: id,
				clientMessageId: id,
				senderId: owner,
				receiverId: receiver,
				content: 'plaintext survives reload',
				timestamp: new Date().toISOString(),
				encryptedMessage: '{"__encrypted":true,"type":3,"body":"QUJD"}',
				sendState: 'pending',
				retryable: true,
				recipientUsername: 'Outbox Recipient'
			};
			await getMessageStore(owner).saveMessage(message);
			return message;
		},
		{ owner: outboxOwnerId, receiver: outboxRecipientId }
	);
	await page.reload();
	const failed = await page.evaluate(
		async ({ owner, id }) => {
			const modulePath = '/src/lib/services/chat.service.ts';
			const { chatService } = await import(/* @vite-ignore */ modulePath);
			chatService.activateOwner(owner);
			return chatService.retryMessage(id, owner);
		},
		{ owner: outboxOwnerId, id: command.clientMessageId }
	);
	expect(failed.sendState).toBe('failed');
	expect(state.messages.size).toBe(1);
	await page.reload();
	const settled = await page.evaluate(
		async ({ owner, id }) => {
			const servicePath = '/src/lib/services/chat.service.ts';
			const storePath = '/src/lib/crypto/messageStore.ts';
			const { chatService } = await import(/* @vite-ignore */ servicePath);
			const { getMessageStore } = await import(/* @vite-ignore */ storePath);
			chatService.activateOwner(owner);
			const accepted = await chatService.retryMessage(id, owner);
			return {
				accepted,
				temporary: await getMessageStore(owner).getMessage(id),
				rows: await getMessageStore(owner).getMessages(accepted.receiverId, owner)
			};
		},
		{ owner: outboxOwnerId, id: command.clientMessageId }
	);
	expect(settled.accepted).toMatchObject({
		sendState: 'accepted',
		content: command.content,
		encryptedMessage: command.encryptedMessage,
		pendingNotification: false
	});
	expect(settled.temporary).toBeNull();
	expect(settled.rows).toHaveLength(1);
	expect(state.commands).toHaveLength(2);
	expect(state.commands[0]).toEqual(state.commands[1]);
	expect(state.commands[0]).toMatchObject({
		expectedSenderId: outboxOwnerId,
		clientMessageId: command.clientMessageId,
		message: command.encryptedMessage
	});
	expect(prekeyRequests).toEqual([]);
});
