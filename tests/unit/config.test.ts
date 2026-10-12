import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock $env/dynamic/public before importing the module under test
vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_API_URL: 'http://test-api:3000' }
}));

// Stub browser storage APIs for Node.js test environment
function createStorageStub(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		get length() {
			return store.size;
		},
		key: (index: number) => [...store.keys()][index] ?? null
	};
}

const localStorageStub = createStorageStub();
const sessionStorageStub = createStorageStub();

// Import after the environment mock
import {
	API_BASE,
	LOGO_URL,
	BACKUP_COOLDOWN_MS,
	getOrCreateDeviceId,
	markBackupDone,
	shouldSkipBackup
} from '$lib/config';

describe('config', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', localStorageStub);
		vi.stubGlobal('sessionStorage', sessionStorageStub);
		localStorageStub.clear();
		sessionStorageStub.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('exports API_BASE from env', () => {
		expect(API_BASE).toBe('http://test-api:3000');
	});

	it('exports LOGO_URL as a Cloudinary URL', () => {
		expect(LOGO_URL).toContain('cloudinary');
	});

	it('exports BACKUP_COOLDOWN_MS as a positive number', () => {
		expect(BACKUP_COOLDOWN_MS).toBeGreaterThan(0);
	});

	describe('getOrCreateDeviceId', () => {
		it('generates and persists a new device ID', () => {
			const id = getOrCreateDeviceId();
			expect(id).toBeTruthy();
			expect(typeof id).toBe('string');
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
			// Should persist
			expect(getOrCreateDeviceId()).toBe(id);
		});

		it.each([undefined, {}])(
			'does not persist an ID when crypto.randomUUID is unavailable (%j)',
			(crypto) => {
				vi.stubGlobal('crypto', crypto);

				expect(() => getOrCreateDeviceId()).toThrow(/crypto\.randomUUID/);
				expect(localStorage.getItem('chatapp_deviceId')).toBeNull();
			}
		);

		it('preserves errors from crypto.randomUUID', () => {
			const error = new Error('secure generator failed');
			vi.stubGlobal('crypto', {
				randomUUID: () => {
					throw error;
				}
			});

			expect(() => getOrCreateDeviceId()).toThrow(error);
			expect(localStorage.getItem('chatapp_deviceId')).toBeNull();
		});

		it('migrates from legacy "deviceId" key', () => {
			localStorage.setItem('deviceId', 'legacy-id');
			const id = getOrCreateDeviceId();
			expect(id).toBe('legacy-id');
			// Old key should be removed
			expect(localStorage.getItem('deviceId')).toBeNull();
			// New key should be set
			expect(localStorage.getItem('chatapp_deviceId')).toBe('legacy-id');
		});

		it('returns existing device ID from namespaced key', () => {
			vi.stubGlobal('crypto', undefined);
			localStorage.setItem('chatapp_deviceId', 'existing-id');
			expect(getOrCreateDeviceId()).toBe('existing-id');
		});

		it('migrates legacy device ID without crypto', () => {
			vi.stubGlobal('crypto', undefined);
			localStorage.setItem('deviceId', 'legacy-id');

			expect(getOrCreateDeviceId()).toBe('legacy-id');
			expect(localStorage.getItem('chatapp_deviceId')).toBe('legacy-id');
		});
	});

	describe('backup cooldown', () => {
		it('shouldSkipBackup returns false when no backup has been done', () => {
			expect(shouldSkipBackup()).toBe(false);
		});

		it('shouldSkipBackup returns true immediately after markBackupDone', () => {
			markBackupDone();
			expect(shouldSkipBackup()).toBe(true);
		});

		it('shouldSkipBackup returns false when cooldown has elapsed', () => {
			// Set the timestamp to well in the past
			sessionStorage.setItem(
				'chatapp_lastBackupTs',
				String(Date.now() - BACKUP_COOLDOWN_MS - 1000)
			);
			expect(shouldSkipBackup()).toBe(false);
		});
	});
});
