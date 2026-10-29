import { beforeEach, describe, expect, it, vi } from 'vitest';
import LocalMessageStore from '$lib/crypto/messageStore';
import type * as MessageStoreExports from '$lib/crypto/messageStore';
import { attachFakeStoreTo, type TransactionControl } from '../utils/fakeIndexedDB';

const mocks = vi.hoisted(() => ({
	send: vi.fn(),
	prekey: vi.fn(),
	encrypt: vi.fn(),
	decrypt: vi.fn(),
	notify: vi.fn(),
	history: vi.fn(),
	conversations: vi.fn(),
	read: vi.fn(),
	hasSession: vi.fn(),
	stores: new Map<string, LocalMessageStore>(),
	disconnect: vi.fn()
}));
vi.mock('$lib/services/api.generated', () => ({
	chatApi: {
		sendMessage: mocks.send,
		getMessages: mocks.history,
		getConversations: mocks.conversations,
		markAsRead: mocks.read
	},
	userApi: { getPrekeyBundle: mocks.prekey }
}));
vi.mock('$lib/crypto/signal', () => ({
	initSignal: vi.fn().mockResolvedValue(undefined),
	hasSession: mocks.hasSession,
	createSessionWithPrekeyBundle: vi.fn(),
	encryptMessage: mocks.encrypt,
	decryptMessage: mocks.decrypt,
	SignalDecryptionError: class extends Error {}
}));
vi.mock('$lib/services/websocket.service', () => ({
	wsService: { sendMessage: mocks.notify, disconnect: mocks.disconnect }
}));
vi.mock('$lib/crypto/messageStore', async (original) => ({
	...(await original<typeof MessageStoreExports>()),
	getMessageStore: (owner: string) => mocks.stores.get(owner)!
}));
const { chatService } = await import('$lib/services/chat.service');
const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

describe('durable encrypted send', () => {
	let store: LocalMessageStore;
	let control: TransactionControl;
	beforeEach(() => {
		vi.clearAllMocks();
		store = new LocalMessageStore('alice');
		control = attachFakeStoreTo(store, vi);
		mocks.stores.set('alice', store);
		mocks.encrypt.mockResolvedValue({ type: 3, body: 'QUJD' });
		mocks.hasSession.mockResolvedValue(false);
		mocks.history.mockResolvedValue({ data: [] });
		mocks.conversations.mockResolvedValue({ data: [] });
		mocks.read.mockResolvedValue({ data: { modifiedCount: 0 } });
		mocks.prekey.mockResolvedValue({ data: { userId: 'bob', deviceId: 'device', bundle: {} } });
		mocks.notify.mockRejectedValue(new Error('offline'));
		mocks.send.mockImplementation(async (body) => ({
			data: {
				id: 'server-id',
				senderId: 'alice',
				receiverId: body.receiverId,
				clientMessageId: body.clientMessageId,
				message: body.message,
				status: 'NotDelivered'
			}
		}));
		chatService.activateOwner('alice');
	});
	it('passes the captured account to every read and receipt request', async () => {
		await chatService.getConversations('alice');
		await chatService.getMessages('bob', 50, 0, 'alice');
		await chatService.markAsRead('bob', 'alice');
		expect(mocks.conversations).toHaveBeenCalledWith('alice');
		expect(mocks.history).toHaveBeenCalledWith('bob', 50, 0, 'alice');
		expect(mocks.read).toHaveBeenCalledWith('bob', 'alice');
	});
	it('keeps durable read state when delivery and stale history arrive later', async () => {
		await store.saveMessage({
			_id: 'server-id',
			senderId: 'alice',
			receiverId: 'bob',
			content: 'read plaintext',
			timestamp: new Date().toISOString(),
			status: 'sent'
		});
		await chatService.applyReceipt({ type: 'read', by: 'bob' }, 'alice');
		await chatService.applyReceipt(
			{ type: 'delivered', messageId: 'server-id', by: 'bob' },
			'alice'
		);
		mocks.history.mockResolvedValue({
			data: [
				{
					id: 'server-id',
					senderId: 'alice',
					receiverId: 'bob',
					message: 'old wire',
					status: 'NotDelivered'
				}
			]
		});
		expect(await chatService.getMessages('bob', 50, 0, 'alice')).toMatchObject([
			{ status: 'read', read: true, content: 'read plaintext' }
		]);
	});

	it('blocks 403 retries until verified same-owner authentication and preserves 409', async () => {
		mocks.send.mockRejectedValue({ status: 403 });
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		const failure = await chatService.retryMessage(pending._id, 'alice');
		expect(failure).toMatchObject({
			sendState: 'failed',
			retryable: false,
			sendError: 'reauthentication_required'
		});
		chatService.activateOwner(null);
		chatService.activateOwner('alice');
		await chatService.retryMessage(pending._id, 'alice');
		expect(mocks.send).toHaveBeenCalledTimes(1);
		await chatService.verifyOwner('alice');
		expect((await store.getMessage(pending._id))?.retryable).toBe(true);
		mocks.send.mockRejectedValue({ status: 409 });
		await chatService.retryMessage(pending._id, 'alice');
		await chatService.verifyOwner('alice');
		expect((await store.getMessage(pending._id))?.retryable).toBe(false);
		expect(mocks.send.mock.calls.every(([body]) => body.expectedSenderId === 'alice')).toBe(true);
	});

	it('shares one transport for concurrent retries', async () => {
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		await Promise.all([
			chatService.retryMessage(pending._id, 'alice'),
			chatService.retryMessage(pending._id, 'alice')
		]);
		expect(mocks.send).toHaveBeenCalledTimes(1);
	});

	it('preserves accepted history when a concurrent REST response is lost', async () => {
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'my plaintext' },
			'alice'
		);
		let reject!: (error: Error) => void;
		mocks.send.mockReturnValue(
			new Promise((_resolve, fail) => {
				reject = fail;
			})
		);
		const attempt = chatService.retryMessage(pending._id, 'alice');
		await pause();
		mocks.history.mockResolvedValue({
			data: [
				{
					id: 'server-id',
					senderId: 'alice',
					receiverId: 'bob',
					clientMessageId: pending.clientMessageId,
					message: pending.encryptedMessage,
					status: 'Seen'
				}
			]
		});
		await chatService.getMessages('bob', 50, 0, 'alice');
		reject(new Error('response lost'));
		expect((await attempt).sendState).toBe('accepted');
		expect(await store.getMessage(pending._id)).toBeNull();
		expect(await store.getMessages('bob', 'alice')).toHaveLength(1);
	});

	it('restores pending recipients and messages while HTTP is unavailable', async () => {
		await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'offline draft' },
			'alice',
			'Bob'
		);
		mocks.conversations.mockRejectedValue(new Error('offline'));
		mocks.history.mockRejectedValue(new Error('offline'));
		expect(await chatService.getConversations('alice')).toMatchObject([
			{ userId: 'bob', username: 'Bob' }
		]);
		expect(await chatService.getMessages('bob', 50, 0, 'alice')).toMatchObject([
			{ content: 'offline draft', sendState: 'pending' }
		]);
	});
	it.each(['history', 'conversations'] as const)(
		'requires verified authentication after %s rejects a changed cookie',
		async (endpoint) => {
			const pending = await chatService.prepareMessage(
				{ receiverId: 'bob', content: 'keep local' },
				'alice'
			);
			mocks[endpoint].mockRejectedValue({ status: 403 });
			const request =
				endpoint === 'history'
					? chatService.getMessages('bob', 50, 0, 'alice')
					: chatService.getConversations('alice');
			await expect(request).rejects.toMatchObject({ status: 403 });
			expect(await store.getMessage(pending._id)).toMatchObject({
				retryable: false,
				sendError: 'reauthentication_required'
			});
			await expect(
				chatService.prepareMessage({ receiverId: 'bob', content: 'blocked' }, 'alice')
			).rejects.toThrow('Account changed');
			expect(mocks.disconnect).toHaveBeenCalled();
		}
	);

	it('rejects another account or conversation history before storage or decryption', async () => {
		mocks.history.mockResolvedValue({
			data: [
				{
					id: 'wrong-owner',
					senderId: 'bob',
					receiverId: 'other',
					message: 'private',
					status: 'Seen'
				}
			]
		});
		await expect(chatService.getMessages('bob', 50, 0, 'alice')).rejects.toThrow('conversation');
		expect(await store.getMessage('wrong-owner')).toBeNull();
		expect(mocks.decrypt).not.toHaveBeenCalled();
	});

	it('does not fetch another prekey for an existing Signal session', async () => {
		mocks.hasSession.mockResolvedValue(true);
		await chatService.prepareMessage({ receiverId: 'bob', content: 'hello' }, 'alice');
		expect(mocks.prekey).not.toHaveBeenCalled();
	});

	it('validates the serialized envelope limit before storage or transport', async () => {
		mocks.encrypt.mockResolvedValue({ type: 3, body: 'A'.repeat(5000) });
		await expect(
			chatService.prepareMessage({ receiverId: 'bob', content: 'hi' }, 'alice')
		).rejects.toThrow('Encrypted message too long');
		expect(await store.getUnfinishedMessages()).toEqual([]);
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it('restores the pending first recipient and its plaintext after reload', async () => {
		await chatService.prepareMessage({ receiverId: 'bob', content: 'hello' }, 'alice', 'Bob');
		chatService.activateOwner(null);
		chatService.activateOwner('alice');
		expect(await chatService.getConversations('alice')).toMatchObject([
			{ userId: 'bob', username: 'Bob', lastMessage: 'You: hello' }
		]);
		expect(await chatService.getMessages('bob', 50, 0, 'alice')).toMatchObject([
			{ content: 'hello', sendState: 'pending' }
		]);
	});

	it('shares history and concurrent socket decryption and claims one notification', async () => {
		const content = JSON.stringify({ __encrypted: true, type: 3, body: 'QUJD' });
		const wire = {
			id: 'incoming-id',
			senderId: 'bob',
			receiverId: 'alice',
			message: content,
			status: 'NotDelivered'
		};
		mocks.history.mockResolvedValue({ data: [wire] });
		mocks.decrypt.mockResolvedValue('decrypted once');
		const incoming = {
			_id: wire.id,
			senderId: 'bob',
			receiverId: 'alice',
			content,
			timestamp: new Date().toISOString()
		};
		const [history, first, duplicate] = await Promise.all([
			chatService.getMessages('bob', 50, 0, 'alice'),
			chatService.receiveMessage(incoming, 'alice'),
			chatService.receiveMessage(incoming, 'alice')
		]);
		expect(mocks.decrypt).toHaveBeenCalledTimes(1);
		expect(history).toHaveLength(1);
		expect([first.fresh, duplicate.fresh].filter(Boolean)).toHaveLength(1);
		expect(await store.getMessages('bob', 'alice')).toHaveLength(1);
		await chatService.receiveMessage(incoming, 'alice');
		expect(mocks.decrypt).toHaveBeenCalledTimes(1);
	});
	it('suppresses cached socket replays after another account initialization', async () => {
		mocks.decrypt.mockResolvedValue('cached plaintext');
		const incoming = {
			_id: 'cached-id',
			senderId: 'bob',
			receiverId: 'alice',
			content: JSON.stringify({ __encrypted: true, type: 3, body: 'QUJD' }),
			timestamp: new Date().toISOString()
		};
		expect((await chatService.receiveMessage(incoming, 'alice')).fresh).toBe(true);
		chatService.activateOwner(null);
		chatService.activateOwner('alice');
		expect((await chatService.receiveMessage(incoming, 'alice')).fresh).toBe(false);
		expect(mocks.decrypt).toHaveBeenCalledTimes(1);
	});

	it('matches own server history to pending plaintext by owner and client ID', async () => {
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'my plaintext' },
			'alice'
		);
		mocks.history.mockResolvedValue({
			data: [
				{
					id: 'accepted-id',
					senderId: 'alice',
					receiverId: 'bob',
					clientMessageId: pending.clientMessageId,
					message: pending.encryptedMessage,
					status: 'Seen'
				}
			]
		});
		expect(await chatService.getMessages('bob', 50, 0, 'alice')).toMatchObject([
			{ _id: 'accepted-id', content: 'my plaintext', status: 'read', sendState: 'accepted' }
		]);
		expect(mocks.decrypt).not.toHaveBeenCalled();
		expect(await store.getMessage(pending._id)).toBeNull();
	});
	it('retains every unfinished row behind the latest history limit, including offline reads', async () => {
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'old unfinished message' },
			'alice'
		);
		await store.saveMessage({ ...pending, timestamp: '2020-01-01T00:00:00Z', sendState: 'failed' });
		await store.saveMessages(
			Array.from({ length: 55 }, (_, index) => ({
				_id: `new-${index}`,
				senderId: 'bob',
				receiverId: 'alice',
				content: 'newer accepted message',
				timestamp: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString()
			}))
		);
		expect(
			(await chatService.getMessages('bob', 50, 0, 'alice')).some(
				(message) => message._id === pending._id
			)
		).toBe(true);
		mocks.history.mockRejectedValue(new Error('offline'));
		expect(
			(await chatService.getMessages('bob', 50, 0, 'alice')).some(
				(message) => message._id === pending._id
			)
		).toBe(true);
	});

	it('notifies accepted history immediately and retries accepted notifications without another POST', async () => {
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		mocks.history.mockResolvedValue({
			data: [
				{
					id: 'accepted-id',
					senderId: 'alice',
					receiverId: 'bob',
					clientMessageId: pending.clientMessageId,
					message: pending.encryptedMessage,
					status: 'NotDelivered'
				}
			]
		});
		await chatService.getMessages('bob', 50, 0, 'alice');
		await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
		mocks.notify.mockResolvedValue(undefined);
		await chatService.retryMessage(pending.clientMessageId!, 'alice');
		expect(mocks.send).not.toHaveBeenCalled();
		expect(await store.getMessage('accepted-id')).toMatchObject({
			sendState: 'accepted',
			pendingNotification: false
		});
	});

	it('keeps old-owner storage after a switch during a pending commit and never sends', async () => {
		control.autoComplete = false;
		const preparation = chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		const rejected = expect(preparation).rejects.toThrow('Account changed');
		await pause();
		chatService.activateOwner('other');
		control.transactions.at(-1)!.complete();
		await rejected;
		control.autoComplete = true;
		expect(await store.getUnfinishedMessages()).toHaveLength(1);
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it('settles late HTTP acceptance only in the captured owner cache', async () => {
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		let finish!: (value: unknown) => void;
		mocks.send.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		const attempt = chatService.retryMessage(pending._id, 'alice');
		await pause();
		const otherStore = new LocalMessageStore('other');
		attachFakeStoreTo(otherStore, vi);
		mocks.stores.set('other', otherStore);
		chatService.activateOwner('other');
		finish({
			data: {
				id: 'server-id',
				senderId: 'alice',
				receiverId: 'bob',
				clientMessageId: pending.clientMessageId,
				message: pending.encryptedMessage,
				status: 'NotDelivered'
			}
		});
		expect((await attempt).sendState).toBe('accepted');
		expect(await store.getMessage('server-id')).toMatchObject({
			content: 'hello',
			pendingNotification: true
		});
		expect(await otherStore.getUnfinishedMessages()).toEqual([]);
		expect(mocks.notify).not.toHaveBeenCalled();
	});

	it('does not clear notification metadata after an ACK from an old account generation', async () => {
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		let finish!: () => void;
		mocks.notify.mockReturnValue(
			new Promise<void>((resolve) => {
				finish = resolve;
			})
		);
		const attempt = chatService.retryMessage(pending._id, 'alice');
		await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
		chatService.activateOwner(null);
		finish();
		expect((await attempt).sendState).toBe('accepted');
		expect(await store.getMessage('server-id')).toMatchObject({ pendingNotification: true });
	});

	it('waits for transaction completion before transport', async () => {
		control.autoComplete = false;
		let prepared = false;
		const preparation = chatService
			.prepareMessage({ receiverId: 'bob', content: 'hello' }, 'alice')
			.then((message) => {
				prepared = true;
				return message;
			});
		await pause();
		expect(prepared).toBe(false);
		expect(mocks.send).not.toHaveBeenCalled();
		control.transactions.at(-1)!.complete();
		const message = await preparation;
		control.autoComplete = true;
		await chatService.retryMessage(message.clientMessageId!, 'alice');
		expect(mocks.send).toHaveBeenCalledTimes(1);
	});

	it('rejects abort after request success and never transmits', async () => {
		control.abortNext = true;
		await expect(
			chatService.sendMessage({ receiverId: 'bob', content: 'hello' }, 'alice')
		).rejects.toThrow('aborted');
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it('retries an accepted command after a lost response with identical ID and cipher', async () => {
		const accepted = new Map();
		mocks.send.mockImplementation(async (body) => {
			if (!accepted.has(body.clientMessageId)) {
				accepted.set(body.clientMessageId, {
					id: 'server-id',
					senderId: 'alice',
					...body,
					status: 'NotDelivered'
				});
				throw new Error('response lost');
			}
			return { data: accepted.get(body.clientMessageId) };
		});
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice',
			'Bob'
		);
		const failed = await chatService.retryMessage(pending.clientMessageId!, 'alice');
		expect(failed.sendState).toBe('failed');
		chatService.activateOwner(null);
		chatService.activateOwner('alice');
		const sent = await chatService.retryMessage(pending.clientMessageId!, 'alice');
		expect(sent.sendState).toBe('accepted');
		expect(mocks.send.mock.calls[0][0]).toEqual(mocks.send.mock.calls[1][0]);
		expect(accepted.size).toBe(1);
		expect(mocks.encrypt).toHaveBeenCalledTimes(1);
		expect(mocks.prekey).toHaveBeenCalledTimes(1);
		expect(await store.getMessage(pending._id)).toBeNull();
		expect((await store.getMessage('server-id'))?.content).toBe('hello');
	});

	it('keeps the pending command when settlement aborts', async () => {
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		control.abortNext = true;
		await expect(
			store.settleMessage(pending._id, { ...pending, _id: 'server-id' })
		).rejects.toThrow('aborted');
		expect(await store.getMessage(pending._id)).toBeTruthy();
		expect(await store.getMessage('server-id')).toBeNull();
	});

	it('retains a terminal conflict without another retry', async () => {
		mocks.send.mockRejectedValue({ status: 409 });
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		const failed = await chatService.retryMessage(pending._id, 'alice');
		expect(failed.retryable).toBe(false);
		await chatService.retryMessage(pending._id, 'alice');
		expect(mocks.send).toHaveBeenCalledTimes(1);
	});

	it.each(['senderId', 'receiverId', 'clientMessageId', 'message'])(
		'retains intent for contradictory %s',
		async (field) => {
			mocks.send.mockImplementation(async (body) => ({
				data: {
					id: 'wrong-id',
					senderId: 'alice',
					...body,
					status: 'NotDelivered',
					[field]: 'contradiction'
				}
			}));
			const pending = await chatService.prepareMessage(
				{ receiverId: 'bob', content: 'hello' },
				'alice'
			);
			const failed = await chatService.retryMessage(pending._id, 'alice');
			expect(failed.sendState).toBe('failed');
			expect(await store.getMessage(pending._id)).toBeTruthy();
			expect(await store.getMessage('wrong-id')).toBeNull();
		}
	);

	it('retains accepted notification until an exact-cipher acknowledgement after reload', async () => {
		const pending = await chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		await chatService.retryMessage(pending._id, 'alice');
		expect((await store.getMessage('server-id'))?.pendingNotification).toBe(true);
		chatService.activateOwner(null);
		chatService.activateOwner('alice');
		mocks.notify.mockResolvedValue(undefined);
		await chatService.flushNotifications('alice');
		expect(mocks.notify.mock.calls.at(-1)![0]).toMatchObject({
			_id: 'server-id',
			clientMessageId: pending.clientMessageId,
			message: pending.encryptedMessage
		});
		expect((await store.getMessage('server-id'))?.pendingNotification).toBe(false);
	});

	it('fences account changes during encryption', async () => {
		let resolve!: (value: { type: number; body: string }) => void;
		mocks.encrypt.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			})
		);
		const preparation = chatService.prepareMessage(
			{ receiverId: 'bob', content: 'hello' },
			'alice'
		);
		await pause();
		chatService.activateOwner('other');
		resolve({ type: 3, body: 'QUJD' });
		await expect(preparation).rejects.toThrow('Account changed');
		expect(mocks.send).not.toHaveBeenCalled();
		expect(await store.getUnfinishedMessages()).toEqual([]);
	});
});
