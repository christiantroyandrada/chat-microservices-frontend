import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dev logger used by the module. Create the mock functions inside the
// factory to avoid referencing hoisted locals (vi.mock is hoisted by Vitest).
vi.mock('$lib/services/dev-logger', () => {
	return { logger: { info: vi.fn(), warning: vi.fn() } };
});

import LocalMessageStore, {
	getMessageStore,
	clearAllLocalMessages,
	deleteMessageDatabase
} from '$lib/crypto/messageStore';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('messageStore API surface', () => {
	it('getMessageStore returns a singleton per userId', () => {
		const s1 = getMessageStore('u1');
		const s2 = getMessageStore('u1');
		expect(s1).toBe(s2);

		const s3 = getMessageStore('u2');
		expect(s3).not.toBe(s1);
	});

	it('clearAllLocalMessages calls clearAll on the store and logs', async () => {
		// Spy on prototype to avoid performing actual DB ops
		const spy = vi.spyOn(LocalMessageStore.prototype, 'clearAll').mockResolvedValue();

		await clearAllLocalMessages('some-user');

		expect(spy).toHaveBeenCalled();
		const devLogger = await import('$lib/services/dev-logger');
		expect(devLogger.logger.info).toHaveBeenCalledWith(
			'[MessageStore] Cleared all local messages for user some-user'
		);
	});

	it('deleteMessageDatabase resolves on success and logs', async () => {
		type MockReq = {
			onsuccess?: () => void;
			onerror?: (e?: unknown) => void;
			onblocked?: () => void;
		};

		const deleteDbImmediate = vi.fn(() => {
			const req: MockReq = {};
			setTimeout(() => req.onsuccess?.(), 0);
			return req as unknown as IDBRequest;
		});
		// attach new mock
		// assign as unknown then cast to IDBFactory to satisfy TS
		// @ts-ignore allow test shim
		globalThis.indexedDB = { deleteDatabase: deleteDbImmediate } as unknown as IDBFactory;

		await expect(deleteMessageDatabase('user-x')).resolves.toBeUndefined();
		const devLogger = await import('$lib/services/dev-logger');
		expect(devLogger.logger.info).toHaveBeenCalledWith(
			'[MessageStore] Deleted database chat-messages-user-x'
		);
	});

	it('deleteMessageDatabase rejects on error', async () => {
		type MockReq = { onsuccess?: () => void; onerror?: (e?: unknown) => void };
		const deleteDbImmediate = vi.fn(() => {
			const req: MockReq = {};
			setTimeout(() => req.onerror?.(new Error('boom')), 0);
			return req as unknown as IDBRequest;
		});
		// @ts-ignore allow test shim
		globalThis.indexedDB = { deleteDatabase: deleteDbImmediate } as unknown as IDBFactory;

		await expect(deleteMessageDatabase('whoops')).rejects.toBeDefined();
	});
});
