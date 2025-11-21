// Polyfill helpers for tests

declare global {
	interface GlobalThis {
		btoa?: (s: string) => string;
		atob?: (s: string) => string;
	}
}

export function ensureBtoaAtob(): void {
	// Use nullish coalescing assignment for concise, idiomatic polyfills
	globalThis.btoa ??= (str: string) => Buffer.from(str, 'binary').toString('base64');
	globalThis.atob ??= (b64: string) => Buffer.from(b64, 'base64').toString('binary');
}

export function btoaFromString(s: string): string {
	// ensureBtoaAtob should have run during setup; fallback to Buffer if not
	return (globalThis.btoa ?? ((str: string) => Buffer.from(str, 'binary').toString('base64')))(s);
}
