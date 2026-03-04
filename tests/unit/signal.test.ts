import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

// We'll mock dependent modules before importing the signal module so that
// module-level state uses our fakes.

const fakeStoreInstances: Array<{
	init: MockedFunction<() => Promise<void>>;
	close: MockedFunction<() => void>;
	clearAllData: MockedFunction<() => Promise<void>>;
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
			clearAllData = vi.fn(async () => {});
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
	clearSignalState: vi.fn(async () => true),
	republishPrekeys: vi.fn(async () => undefined)
}));

vi.mock('$lib/crypto/signalSession', () => ({
	createSessionWithPrekeyBundle: vi.fn(async () => ({})),
	encryptMessage: vi.fn(async () => ({ type: 1, body: 'YYY' })),
	decryptMessage: vi.fn(async () => 'plaintext'),
	hasSession: vi.fn(async () => true),
	removeSessionWith: vi.fn(async () => undefined)
}));

// Mock $lib/config — signal.ts imports shouldSkipBackup / markBackupDone from
// here, and config.ts imports $env/dynamic/public which doesn't exist in Vitest.
vi.mock('$lib/config', () => ({
	API_BASE: 'http://localhost',
	LOGO_URL: 'https://example.com/logo.png',
	getOrCreateDeviceId: vi.fn().mockReturnValue('test-device-id'),
	shouldSkipBackup: vi.fn().mockReturnValue(false),
	markBackupDone: vi.fn(),
	BACKUP_COOLDOWN_MS: 300000
}));

vi.mock('$lib/services/dev-logger', () => ({
	logger: {
		info: vi.fn(),
		warning: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
		debug: vi.fn()
	}
}));

// Mock auth.service dynamic import used in restore flow. Use shared mock from
// tests/utils so multiple test files can reuse and modify it.
import {
	authService,
	setFetchSignalKeys,
	setFetchSignalKeysToThrow,
	setStoreSignalKeysToThrow,
	resetAuthMock
} from '../utils/authMock';
vi.mock('$lib/services/auth.service', () => ({ authService }));

// Now import the module under test freshly per test when needed
import type * as SignalModule from '$lib/crypto/signal';
let Signal: typeof SignalModule;

beforeEach(async () => {
	vi.clearAllMocks();
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
			republishPrekeys: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
		};
		backup.decryptAndImportSignalKeys.mockResolvedValue({});
		backup.republishPrekeys.mockResolvedValue(undefined);

		const res = await Signal.initSignalWithRestore('restore-user', 'dev1', 'api', 'pw');
		expect(res).toBe(true);
		// clearAllData should have been called on the store (instead of deleting the database)
		const inst = fakeStoreInstances.find(
			(s) => (s as unknown as { userId: string }).userId === 'restore-user'
		);
		expect(inst?.clearAllData).toHaveBeenCalled();
		// republishPrekeys should have been called to sync the server
		expect(backup.republishPrekeys).toHaveBeenCalled();
		// reset mock
		resetAuthMock();
	});

	it('initSignalWithRestore uses local keys without password (does NOT regenerate)', async () => {
		// Backend returns no keys, local keys exist, but no password provided
		// This simulates a page refresh after the tab was closed (sessionStorage lost)
		const backup = (await import('$lib/crypto/signalBackup')) as unknown as {
			hasLocalKeys: MockedFunction<(...args: unknown[]) => Promise<boolean>>;
			generateAndPublishIdentity: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
			republishPrekeys: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
		};
		backup.hasLocalKeys.mockResolvedValue(true);

		const res = await Signal.initSignalWithRestore('local-keys-user', 'dev3', 'api');
		expect(res).toBe(true);
		// MUST NOT generate new keys when local keys already exist
		expect(backup.generateAndPublishIdentity).not.toHaveBeenCalled();
		// Path 2 always re-publishes prekeys to keep server in sync
		expect(backup.republishPrekeys).toHaveBeenCalled();
		resetAuthMock();
	});

	it('initSignalWithRestore uses local keys when backend has keys but no password', async () => {
		// Backend has encrypted keys but we have no password to decrypt them.
		// Local IndexedDB still has the keys → use them instead of regenerating.
		setFetchSignalKeys({ encrypted: true });
		const backup = (await import('$lib/crypto/signalBackup')) as unknown as {
			hasLocalKeys: MockedFunction<(...args: unknown[]) => Promise<boolean>>;
			generateAndPublishIdentity: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
			republishPrekeys: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
		};
		backup.hasLocalKeys.mockResolvedValue(true);

		const res = await Signal.initSignalWithRestore('no-pw-user', 'dev4', 'api');
		expect(res).toBe(true);
		// MUST NOT generate new keys — local keys are still good
		expect(backup.generateAndPublishIdentity).not.toHaveBeenCalled();
		// Path 2 always re-publishes prekeys to keep server in sync
		expect(backup.republishPrekeys).toHaveBeenCalled();
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

	it('initSignalWithRestore returns true even when backup is rate-limited (429)', async () => {
		// Backend has no encrypted keys → Path 2 (has local keys + password)
		// storeSignalKeys throws 429 → must be swallowed, init must still succeed
		const rateLimitErr = Object.assign(new Error('Rate limit: Please wait'), { status: 429 });
		setStoreSignalKeysToThrow(rateLimitErr);

		const backup = (await import('$lib/crypto/signalBackup')) as unknown as {
			hasLocalKeys: MockedFunction<(...args: unknown[]) => Promise<boolean>>;
			generateAndPublishIdentity: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
			republishPrekeys: MockedFunction<(...args: unknown[]) => Promise<unknown>>;
		};
		backup.hasLocalKeys.mockResolvedValue(true);

		const res = await Signal.initSignalWithRestore('rate-limit-user', 'dev5', 'api', 'pw');
		// Must succeed — 429 on backup is non-fatal
		expect(res).toBe(true);
		// Must NOT regenerate keys when local keys exist
		expect(backup.generateAndPublishIdentity).not.toHaveBeenCalled();
		// Path 2 always re-publishes prekeys to keep server in sync
		expect(backup.republishPrekeys).toHaveBeenCalled();
		resetAuthMock();
	});
});
