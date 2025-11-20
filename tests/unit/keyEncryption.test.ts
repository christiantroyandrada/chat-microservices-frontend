import { describe, it, expect } from 'vitest';
import type { EncryptedKeyBundle } from '$lib/types';

import { validatePasswordStrength, decryptKeySet } from '$lib/crypto/keyEncryption';

describe('keyEncryption utilities (pure / fast checks)', () => {
	it('validatePasswordStrength rejects weak passwords and accepts strong ones', () => {
		const weak = validatePasswordStrength('short');
		expect(weak.valid).toBe(false);
		expect(weak.errors.length).toBeGreaterThan(0);

		const almost = validatePasswordStrength('LongerbutNo$1');
		// this password meets the minimum categories and length so it should be valid
		expect(almost.valid).toBe(true);

		const strong = validatePasswordStrength('Str0ng!Passw0rd#2025');
		expect(strong.valid).toBe(true);
		expect(strong.errors.length).toBe(0);
	});

	it('decryptKeySet throws when bundle version is unsupported', async () => {
		const badBundle = {
			encrypted: 'AAA',
			iv: 'BBB',
			salt: 'CCC',
			version: 999,
			deviceId: 'd1'
		} as unknown as EncryptedKeyBundle;

		await expect(decryptKeySet(badBundle, 'password')).rejects.toThrow(
			/Unsupported encryption version/
		);
	});
});
