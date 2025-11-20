import { describe, it, expect } from 'vitest';

import {
	DEFAULT_DEVICE_ID,
	DEFAULT_SIGNED_PREKEY_ID,
	PREKEY_COUNT,
	MAX_PREKEY_SCAN,
	STORE_NAME,
	DB_NAME_PREFIX
} from '$lib/crypto/signalConstants';

describe('signalConstants', () => {
	it('exports expected defaults', () => {
		expect(DEFAULT_DEVICE_ID).toBe(1);
		expect(DEFAULT_SIGNED_PREKEY_ID).toBe(1);
		expect(typeof PREKEY_COUNT).toBe('number');
		expect(PREKEY_COUNT).toBeGreaterThanOrEqual(1);
		expect(MAX_PREKEY_SCAN).toBeGreaterThanOrEqual(1);
		expect(STORE_NAME).toBe('state');
		expect(DB_NAME_PREFIX).toBe('signal-protocol-store-');
	});
});
