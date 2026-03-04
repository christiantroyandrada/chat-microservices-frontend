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

vi.stubGlobal('localStorage', localStorageStub);
vi.stubGlobal('sessionStorage', sessionStorageStub);

// Import after mock + stubs
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
		localStorageStub.clear();
		sessionStorageStub.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
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
			// Should persist
			expect(getOrCreateDeviceId()).toBe(id);
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
			localStorage.setItem('chatapp_deviceId', 'existing-id');
			expect(getOrCreateDeviceId()).toBe('existing-id');
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
