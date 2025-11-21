/* stylelint-disable */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import LocalMessageStore from '$lib/crypto/messageStore';
import type { Message } from '$lib/types';
import { attachFakeStoreTo } from '../utils/fakeIndexedDB';

function makeMsg(id: string, sender: string, receiver: string, ts: string): Message {
	return {
		_id: id,
		senderId: sender,
		receiverId: receiver,
		content: `m-${id}`,
		timestamp: ts
	} as unknown as Message;
}

describe('LocalMessageStore (in-memory fake DB)', () => {
	let store: LocalMessageStore;

	beforeEach(async () => {
		store = new LocalMessageStore('test-user');

		// Use shared in-memory fake object store and attach it to the store
		attachFakeStoreTo(store, vi);

		// Ensure init runs and store is cleared for test start
		await store.init();
		await store.clearAll();
	});

	it('saveMessage/getMessage/hasMessage works', async () => {
		const m = makeMsg('1', 'alice', 'bob', '2020-01-01T00:00:00Z');
		await store.saveMessage(m);

		const loaded = await store.getMessage('1');
		expect(loaded).toBeDefined();
		expect(loaded?._id).toBe('1');

		expect(await store.hasMessage('1')).toBe(true);
	});

	it('saveMessages and getMessages returns conversation messages sorted', async () => {
		const msgs = [
			makeMsg('a', 'alice', 'bob', '2020-01-01T00:00:01Z'),
			makeMsg('b', 'bob', 'alice', '2020-01-01T00:00:02Z'),
			makeMsg('c', 'alice', 'charlie', '2020-01-01T00:00:03Z')
		];

		await store.saveMessages(msgs);

		const conv = await store.getMessages('bob', 'alice', 50);
		expect(conv.some((m) => m._id === 'a')).toBe(true);
		expect(conv.some((m) => m._id === 'b')).toBe(true);
		expect(conv.some((m) => m._id === 'c')).toBe(false);
	});

	it('deleteConversation deletes messages for that conversation', async () => {
		const msgs = [
			makeMsg('1', 'alice', 'bob', '2020-01-01T00:00:01Z'),
			makeMsg('2', 'bob', 'alice', '2020-01-01T00:00:02Z'),
			makeMsg('3', 'alice', 'charlie', '2020-01-01T00:00:03Z')
		];
		await store.saveMessages(msgs);

		await store.deleteConversation('bob', 'alice');

		const conv = await store.getMessages('bob', 'alice', 50);
		expect(conv.length).toBe(0);

		const other = await store.getMessages('charlie', 'alice', 50);
		expect(other.length).toBe(1);
	});

	it('clearAll removes everything', async () => {
		await store.saveMessage(makeMsg('x', 'a', 'b', '2020-01-02'));
		await store.clearAll();
		const m = await store.getMessage('x');
		expect(m).toBeNull();
	});

	it('saveMessages with empty array resolves immediately', async () => {
		await expect(store.saveMessages([])).resolves.toBeUndefined();
	});

	it('getMessage returns null for non-existent message', async () => {
		const result = await store.getMessage('non-existent');
		expect(result).toBeNull();
	});

	it('hasMessage returns false for non-existent message', async () => {
		const result = await store.hasMessage('non-existent');
		expect(result).toBe(false);
	});

	it('getMessages handles empty conversation', async () => {
		const messages = await store.getMessages('alice', 'unknown-user', 50);
		expect(messages).toEqual([]);
	});

	it('getMessages respects limit parameter', async () => {
		const msgs = Array.from({ length: 10 }, (_, i) =>
			makeMsg(`msg-${i}`, 'alice', 'bob', `2020-01-01T00:00:${String(i).padStart(2, '0')}Z`)
		);
		await store.saveMessages(msgs);

		const limited = await store.getMessages('bob', 'alice', 5);
		expect(limited.length).toBe(5);
	});

	it('saveMessage handles update of existing message', async () => {
		const m1 = makeMsg('1', 'alice', 'bob', '2020-01-01');
		await store.saveMessage(m1);

		const m2 = { ...m1, content: 'updated content' };
		await store.saveMessage(m2);

		const loaded = await store.getMessage('1');
		expect(loaded?.content).toBe('updated content');
	});

	it('deleteConversation removes all messages between users', async () => {
		const msgs = [
			makeMsg('1', 'alice', 'bob', '2020-01-01T00:00:01Z'),
			makeMsg('2', 'bob', 'alice', '2020-01-01T00:00:02Z'),
			makeMsg('3', 'alice', 'bob', '2020-01-01T00:00:03Z')
		];
		await store.saveMessages(msgs);

		await store.deleteConversation('bob', 'alice');

		const conv = await store.getMessages('bob', 'alice', 50);
		expect(conv.length).toBe(0);

		// Verify messages are actually gone
		expect(await store.hasMessage('1')).toBe(false);
		expect(await store.hasMessage('2')).toBe(false);
		expect(await store.hasMessage('3')).toBe(false);
	});
});
