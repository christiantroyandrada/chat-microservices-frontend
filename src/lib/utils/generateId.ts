// Display-only fallback IDs need uniqueness within this module, not unpredictability.
let fallbackId = 0;

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

	// Display IDs stay usable without crypto; they are not security credentials.
	return `${Date.now()}-${++fallbackId}-${idx}`;
}

export default generateId;
