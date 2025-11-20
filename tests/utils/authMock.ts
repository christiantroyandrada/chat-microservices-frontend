// Lightweight auth service mock used by tests. Export a shared `authService`
// object so tests can import and modify its behavior without re-declaring it.
import { vi } from 'vitest';

// Define a small type for the encrypted bundle shape we expect in tests.
export type EncryptedKeyBundle = { encrypted: boolean } | null;

export const authService: {
	fetchSignalKeys: (...args: any[]) => Promise<EncryptedKeyBundle>;
	storeSignalKeys: (...args: any[]) => Promise<void>;
} = {
	fetchSignalKeys: vi.fn(async () => null),
	storeSignalKeys: vi.fn(async () => undefined)
};

// Helpers to mutate the authService mock behavior in a typed way.
export function setFetchSignalKeys(value: EncryptedKeyBundle) {
	authService.fetchSignalKeys = vi.fn(async () => value);
}

export function setFetchSignalKeysToThrow(err: any) {
	authService.fetchSignalKeys = vi.fn(async () => {
		throw err;
	});
}

export function resetAuthMock() {
	authService.fetchSignalKeys = vi.fn(async () => null);
	authService.storeSignalKeys = vi.fn(async () => undefined);
}

export default authService;
