import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

// We'll mock dependent modules before importing the signal module so that
// module-level state uses our fakes.

const fakeStoreInstances: Array<{
	init: MockedFunction<() => Promise<void>>;
	close: MockedFunction<() => void>;
	asStorageType?: () => unknown;
}> = [];

vi.mock('$lib/crypto/signalStore', () => {
	return {
		IndexedDBSignalProtocolStore: class {
			userId: string;
			constructor(userId: string) {
				this.userId = userId;
				fakeStoreInstances.push(this);
			}
			init = vi.fn(async () => {});
			close = vi.fn(() => {});
			asStorageType = () => ({});
		}
	};
});

vi.mock('$lib/crypto/signalKeyManager', () => ({
	generateSignalIdentity: vi.fn(async (_store: unknown) => ({ id: 'ident' })),
	publishSignalPrekey: vi.fn(async () => ({ success: true })),
	exportSignalKeys: vi.fn(async () => ({ exported: true })),
	importSignalKeys: vi.fn(async () => ({ imported: true }))
}));

vi.mock('$lib/crypto/signalBackup', () => ({
	generateAndPublishIdentity: vi.fn(async () => ({ published: true })),
	hasLocalKeys: vi.fn(async () => false),
	exportAndEncryptSignalKeys: vi.fn(async () => ({ encrypted: true })),
	decryptAndImportSignalKeys: vi.fn(async () => ({})),
	clearSignalState: vi.fn(async () => true)
}));

vi.mock('$lib/crypto/signalSession', () => ({
	createSessionWithPrekeyBundle: vi.fn(async () => ({})),
	encryptMessage: vi.fn(async () => ({ type: 1, body: 'YYY' })),
	decryptMessage: vi.fn(async () => 'plaintext'),
	hasSession: vi.fn(async () => true),
	removeSessionWith: vi.fn(async () => undefined)
}));

// Mock auth.service dynamic import used in restore flow. Use shared mock from
// tests/utils so multiple test files can reuse and modify it.
import {
	authService,
	setFetchSignalKeys,
	setFetchSignalKeysToThrow,
	resetAuthMock
} from '../utils/authMock';
vi.mock('$lib/services/auth.service', () => ({ authService }));

// Now import the module under test freshly per test when needed
import type * as SignalModule from '$lib/crypto/signal';
let Signal: typeof SignalModule;

beforeEach(async () => {
	vi.resetModules();
	fakeStoreInstances.length = 0;
	// re-import module under test so it picks up fresh mocks
	Signal = await import('$lib/crypto/signal');
});

describe('signal module facade', () => {
	it('initSignal throws when called without userId first', async () => {
		await expect(Signal.initSignal()).rejects.toThrow(/requires userId/);
	});

	it('initSignal initializes store when userId provided', async () => {
		await Signal.initSignal('user1');
		expect(fakeStoreInstances.length).toBeGreaterThan(0);
		const inst = fakeStoreInstances[0];
		expect(inst.init).toHaveBeenCalled();
	});

	it('generateSignalIdentity delegates to KeyManager', async () => {
		await Signal.initSignal('u2');
		const res = await Signal.generateSignalIdentity();
		expect(res).toEqual({ id: 'ident' });
	});

	it('publishSignalPrekey delegates to KeyManager', async () => {
		const out = await Signal.publishSignalPrekey('api', 'u', 'd', {
			identityKey: 'A'
		} as unknown as Parameters<typeof Signal.publishSignalPrekey>[3]);
		expect(out).toEqual({ success: true });
	});

	it('generateAndPublishIdentity calls backup generateAndPublishIdentity', async () => {
		const out = await Signal.generateAndPublishIdentity('api', 'u3', 'd1');
		expect(out).toEqual({ published: true });
	});

	it('session operations delegate to Session module', async () => {
		await Signal.initSignal('sess-user');
		await Signal.createSessionWithPrekeyBundle({ bundle: true }, 'sess-user');
		const session = (await import('$lib/crypto/signalSession')) as unknown as {
			createSessionWithPrekeyBundle: (...args: unknown[]) => unknown;
			removeSessionWith: (...args: unknown[]) => unknown;
		};
		expect(session.createSessionWithPrekeyBundle).toHaveBeenCalled();

		const enc = await Signal.encryptMessage('recipient', 'hello', 'sess-user');
		expect(enc).toHaveProperty('body');

		const dec = await Signal.decryptMessage(
			'sender',
			{ type: 1, body: 'A' } as unknown as Parameters<typeof Signal.decryptMessage>[1],
			'sess-user'
		);
		expect(dec).toBe('plaintext');

		const has = await Signal.hasSession('other', 'sess-user');
		expect(has).toBe(true);

		await Signal.removeSessionWith('other', 'sess-user');
		expect(session.removeSessionWith).toHaveBeenCalled();
	});

	it('backup and export/import functions delegate', async () => {
		await Signal.initSignal('bk');
		const has = await Signal.hasLocalKeys('bk');
		expect(has).toBe(false);

		const exported = await Signal.exportSignalKeys('bk');
		expect(exported).toEqual({ exported: true });

		const imported = await Signal.importSignalKeys(
			'bk',
			{} as unknown as Parameters<typeof Signal.importSignalKeys>[1]
		);
		expect(imported).toEqual({ imported: true });
	});

	it('clearSignalState closes store and delegates to Backup.clearSignalState', async () => {
		await Signal.initSignal('clear-me');
		const inst = fakeStoreInstances[0];
		const r = await Signal.clearSignalState('clear-me');
		expect(inst.close).toHaveBeenCalled();
		const backup = (await import('$lib/crypto/signalBackup')) as unknown as {
			clearSignalState: (...args: unknown[]) => unknown;
		};
		expect(backup.clearSignalState).toHaveBeenCalledWith('clear-me');
		expect(r).toBe(true);
	});

	it('initSignalWithRestore uses backend encrypted bundle path', async () => {
		// make authService return an encrypted bundle
		setFetchSignalKeys({ encrypted: true });
		const backup = (await import('$lib/crypto/signalBackup')) as unknown as {
			decryptAndImportSignalKeys: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
		};
		backup.decryptAndImportSignalKeys.mockResolvedValue({});

		const res = await Signal.initSignalWithRestore('restore-user', 'dev1', 'api', 'pw');
		expect(res).toBe(true);
		// reset mock
		resetAuthMock();
	});

	it('initSignalWithRestore falls back to local keys when backend fetch fails', async () => {
		setFetchSignalKeysToThrow(new Error('network'));
		const backup = (await import('$lib/crypto/signalBackup')) as unknown as {
			hasLocalKeys: MockedFunction<(...args: unknown[]) => Promise<boolean>>;
		};
		backup.hasLocalKeys.mockResolvedValue(true);

		const res = await Signal.initSignalWithRestore('restore-user-2', 'dev2', 'api', 'pw');
		expect(res).toBe(true);
		resetAuthMock();
	});
});
