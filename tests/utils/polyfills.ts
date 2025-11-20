// Polyfill helpers for tests
export function ensureBtoaAtob(): void {
	if ((globalThis as any).btoa === undefined) {
		(globalThis as any).btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
	}
	if ((globalThis as any).atob === undefined) {
		(globalThis as any).atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
	}
}

export function btoaFromString(s: string): string {
	return (globalThis as any).btoa(s);
}
