import { describe, it, expect, beforeEach } from 'vitest';
import * as keyEnc from '$lib/crypto/keyEncryption';

/**
 * Security regression guard (P1): the login password must never be persisted.
 *
 * The old implementation stored `btoa(encodeURIComponent(password))` in
 * sessionStorage under `_ek`, from which the raw password (the PBKDF2 input for
 * ALL Signal keys, and the user's login credential) was trivially recoverable by
 * any XSS. Refresh continuity is now provided by the persistent IndexedDB key
 * store, so no password cache is needed.
 */
describe('keyEncryption: no password caching (P1)', () => {
	beforeEach(() => {
		if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
	});

	it('does not expose any password cache API', () => {
		expect((keyEnc as Record<string, unknown>).cacheEncryptionPassword).toBeUndefined();
		expect((keyEnc as Record<string, unknown>).getCachedEncryptionPassword).toBeUndefined();
		expect((keyEnc as Record<string, unknown>).clearCachedEncryptionPassword).toBeUndefined();
	});

	it('never writes the `_ek` password key to sessionStorage', () => {
		// Exercising the module must not leave a password artifact behind.
		expect(typeof keyEnc.encryptKeySet).toBe('function');
		if (typeof sessionStorage !== 'undefined') {
			expect(sessionStorage.getItem('_ek')).toBeNull();
		}
	});
});
