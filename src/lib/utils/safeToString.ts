// Safely convert various shapes to strings. Avoids default Object stringification
// which yields '[object Object]' when the value is an object.
export function safeToString(value: unknown, fallback = ''): string {
	if (value === undefined || value === null) return fallback;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (typeof value === 'object') {
		const o = value as Record<string, unknown>;
		// Common id-like fields on objects
		const idCandidate = o['_id'] ?? o['id'] ?? o['uuid'] ?? o['id_str'] ?? o['_id_str'];
		if (idCandidate !== undefined) return String(idCandidate);

		// If object has a custom toString that doesn't return the default, use it
		const maybeToString = (o as unknown as { toString?: () => unknown }).toString;
		if (typeof maybeToString === 'function') {
			try {
				const s = maybeToString.call(o);
				if (s && s !== '[object Object]') return String(s);
			} catch {
				// ignore and fallback to JSON
			}
		}

		try {
			return JSON.stringify(o);
		} catch {
			return fallback;
		}
	}
	return String(value);
}
