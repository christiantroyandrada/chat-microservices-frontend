import { vi } from 'vitest';

// Install a deterministic WebCrypto stub suitable for unit tests.
export function installDeterministicWebCrypto() {
	const importKey = async (_format: string, keyData: ArrayBuffer | Uint8Array) => {
		const secret = new TextDecoder().decode(keyData as ArrayBuffer);
		return { secret } as { secret: string };
	};

	const deriveKey = async (params: { salt: ArrayBuffer }, keyMaterial: { secret: string }) => {
		const saltArr = Array.from(new Uint8Array(params.salt));
		const secret = `${keyMaterial.secret}:${saltArr.join(',')}`;
		return { secret } as { secret: string };
	};

	const encrypt = async (_algo: unknown, key: { secret: string }, plaintext: ArrayBuffer) => {
		const plainBytes = new Uint8Array(plaintext);
		const plainStr = Array.from(plainBytes)
			.map((b) => String.fromCodePoint(b))
			.join('');
		const base64Plain = (globalThis as unknown as { btoa?: (s: string) => string }).btoa!(plainStr);
		const combined = `${key.secret}|${base64Plain}`;
		const enc = new TextEncoder().encode(combined);
		return enc.buffer;
	};

	const decrypt = async (_algo: unknown, key: { secret: string }, encrypted: ArrayBuffer) => {
		const combined = new TextDecoder().decode(encrypted);
		const [secret, base64Plain] = combined.split('|');
		if (secret !== key.secret) throw new Error('Decryption failed');
		const plainStr = (globalThis as unknown as { atob?: (s: string) => string }).atob!(base64Plain);
		const bytes = new Uint8Array(plainStr.length);
		for (let i = 0; i < plainStr.length; i++) bytes[i] = plainStr.codePointAt(i) ?? 0;
		return bytes.buffer;
	};

	const previousCrypto = (globalThis as unknown as { crypto?: unknown }).crypto;
	const previousWindow = (globalThis as unknown as { window?: Window }).window;
	const previousWindowCrypto = previousWindow
		? (previousWindow as unknown as { crypto?: unknown }).crypto
		: undefined;

	const stubbedCrypto = {
		getRandomValues: (arr: Uint8Array) => {
			for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
			return arr;
		},
		subtle: {
			importKey,
			deriveKey,
			encrypt,
			decrypt
		}
	} as unknown as Crypto;

	// Install the stub on globalThis and on window (if present) so browser-like
	// client tests that reference window.crypto continue to work.
	vi.stubGlobal('crypto', stubbedCrypto);
	if ((globalThis as unknown as { window?: Window }).window) {
		// Try to define the crypto property on window in a robust, typed way.
		const gw = globalThis as unknown as { window?: Record<string, unknown> };
		try {
			Object.defineProperty(gw.window as Record<string, unknown>, 'crypto', {
				value: stubbedCrypto,
				configurable: true,
				writable: true
			});
		} catch {
			// fallback: attempt a direct assignment if defineProperty fails (some test
			// environments may have non-configurable globals). Use a narrow unknown cast.
			try {
				(gw.window as unknown as { crypto?: unknown }).crypto = stubbedCrypto;
			} catch {
				// ignore immutability issues in some environments
			}
		}
	}

	return function uninstall() {
		// Helper to run an operation and swallow any thrown errors.
		const safe = (fn: () => void) => {
			try {
				fn();
			} catch {
				/* ignore */
			}
		};

		// Prefer to use vitest's unstubGlobal if available to remove the stub.
		safe(() => {
			const maybe = vi as unknown as { unstubGlobal?: (name: string) => void };
			if (typeof maybe.unstubGlobal === 'function') {
				maybe.unstubGlobal('crypto');
			}
		});

		// Restore globalThis.crypto to its previous value (or remove it).
		if (previousCrypto === undefined) {
			// Try to delete, otherwise set to undefined.
			safe(() => delete (globalThis as unknown as { crypto?: unknown }).crypto);
			safe(() => ((globalThis as unknown as { crypto?: unknown }).crypto = undefined));
		} else {
			safe(() => ((globalThis as unknown as { crypto?: unknown }).crypto = previousCrypto));
		}

		// Restore window.crypto when applicable. Keep behavior identical to
		// the original but with a flatter control flow.
		if (previousWindow) {
			safe(() => {
				(previousWindow as unknown as { crypto?: unknown }).crypto = previousWindowCrypto;
			});
		} else if (
			(globalThis as unknown as { window?: Window }).window &&
			previousWindowCrypto === undefined
		) {
			// No previous window object: remove stubbed crypto if it was set
			const gw = globalThis as unknown as { window?: Record<string, unknown> };
			safe(() => {
				if (gw.window) {
					// use indexed access to avoid `any`
					delete (gw.window as Record<string, unknown>)['crypto'];
				}
			});
			safe(() => {
				if (gw.window) {
					(gw.window as Record<string, unknown>)['crypto'] = undefined;
				}
			});
		}
	};
}
