/**
 * Secure-ish ID generator for client-side use.
 *
 * Uses the platform crypto API when available (randomUUID or getRandomValues).
 * Falls back to a Math.random-based hex when no crypto is present.
 */
export function generateId(idx = 0): string {
	try {
		// Narrow globalThis to an object that may have a crypto implementation.
		const g = globalThis as unknown as {
			crypto?: {
				randomUUID?: () => string;
				getRandomValues?: (arr: Uint8Array) => Uint8Array;
			};
		};

		const c = g.crypto;
		if (c) {
			if (typeof c.randomUUID === 'function') {
				return `${Date.now()}-${c.randomUUID()}-${idx}`;
			}
			if (typeof c.getRandomValues === 'function') {
				const arr = new Uint8Array(8);
				c.getRandomValues(arr);
				const hex = Array.from(arr)
					.map((b) => b.toString(16).padStart(2, '0'))
					.join('');
				return `${Date.now()}-${hex}-${idx}`;
			}
		}
	} catch {
		// ignore and fall back
	}

	// Last-resort fallback (not cryptographically secure).
	return `${Date.now()}-${Math.floor(Math.random() * 0xffffffff).toString(16)}-${idx}`;
}

export default generateId;
