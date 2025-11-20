/* stylelint-disable */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import LocalMessageStore from '$lib/crypto/messageStore';
import { attachFakeStoreTo } from '../utils/fakeIndexedDB';

function makeMsg(id: string, sender: string, receiver: string, ts: string) {
	return {
		_id: id,
		senderId: sender,
		receiverId: receiver,
		content: `m-${id}`,
		timestamp: ts
	} as any;
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
});
