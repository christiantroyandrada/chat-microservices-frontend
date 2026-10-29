import { describe, expect, it } from 'vitest';
import LocalMessageStore from '$lib/crypto/messageStore';
import type { Message } from '$lib/types';

describe('native IndexedDB durability', () => {
	it('aborts queued writes if settlement throws synchronously', async () => {
		const store = new LocalMessageStore(crypto.randomUUID());
		const pending: Message = {
			_id: 'client-id',
			senderId: 'owner',
			receiverId: 'recipient',
			content: 'keep me',
			timestamp: new Date().toISOString()
		};
		await store.saveMessage(pending);
		const database = (store as unknown as { db: IDBDatabase }).db;
		const transaction = database.transaction.bind(database);
		const originalTransaction = database.transaction;
		database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
			const tx = transaction(...args);
			const objectStore = tx.objectStore.bind(tx);
			tx.objectStore = (name: string) => {
				const messages = objectStore(name);
				messages.delete = () => {
					throw new Error('enqueue failed');
				};
				return messages;
			};
			return tx;
		}) as IDBDatabase['transaction'];
		await expect(
			store.settleMessage('client-id', { ...pending, _id: 'server-id' })
		).rejects.toThrow('enqueue failed');
		database.transaction = originalTransaction;
		expect(await store.getMessage('client-id')).toEqual(pending);
		expect(await store.getMessage('server-id')).toBeNull();
		await store.clearAll();
	});
	it('restores a command through a new store and settles it atomically', async () => {
		const owner = crypto.randomUUID();
		const clientMessageId = crypto.randomUUID();
		const pending: Message = {
			_id: clientMessageId,
			clientMessageId,
			senderId: owner,
			receiverId: 'recipient',
			content: 'local plaintext',
			timestamp: new Date().toISOString(),
			encryptedMessage: '{"__encrypted":true,"type":3,"body":"QUJD"}',
			sendState: 'failed',
			retryable: true
		};
		const store = new LocalMessageStore(owner);
		await store.saveMessage(pending);
		const restored = new LocalMessageStore(owner);
		expect(await restored.getMessage(clientMessageId)).toEqual(pending);
		await restored.settleMessage(clientMessageId, {
			...pending,
			_id: 'server-id',
			sendState: 'accepted',
			pendingNotification: true
		});
		const afterSettlement = new LocalMessageStore(owner);
		expect(await afterSettlement.getMessage(clientMessageId)).toBeNull();
		expect(await afterSettlement.getMessage('server-id')).toMatchObject({
			content: 'local plaintext',
			pendingNotification: true
		});
		await afterSettlement.clearAll();
	});
});
