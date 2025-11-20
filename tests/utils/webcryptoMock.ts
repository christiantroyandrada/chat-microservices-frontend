import { vi } from 'vitest';

// Install a deterministic WebCrypto stub suitable for unit tests.
export function installDeterministicWebCrypto() {
	const importKey = async (_format: string, keyData: ArrayBuffer | Uint8Array) => {
		const secret = new TextDecoder().decode(keyData as ArrayBuffer);
		return { secret } as any;
	};

	const deriveKey = async (params: any, keyMaterial: any) => {
		const saltArr = Array.from(new Uint8Array(params.salt));
		const secret = `${keyMaterial.secret}:${saltArr.join(',')}`;
		return { secret } as any;
	};

	const encrypt = async (_algo: any, key: any, plaintext: ArrayBuffer) => {
		const plainBytes = new Uint8Array(plaintext);
		const plainStr = Array.from(plainBytes)
			.map((b) => String.fromCodePoint(b))
			.join('');
		const base64Plain = (globalThis as any).btoa(plainStr);
		const combined = `${key.secret}|${base64Plain}`;
		const enc = new TextEncoder().encode(combined);
		return enc.buffer;
	};

	const decrypt = async (_algo: any, key: any, encrypted: ArrayBuffer) => {
		const combined = new TextDecoder().decode(encrypted);
		const [secret, base64Plain] = combined.split('|');
		if (secret !== key.secret) throw new Error('Decryption failed');
		const plainStr = (globalThis as any).atob(base64Plain);
		const bytes = new Uint8Array(plainStr.length);
		for (let i = 0; i < plainStr.length; i++) bytes[i] = plainStr.codePointAt(i) ?? 0;
		return bytes.buffer;
	};

	const previousCrypto = (globalThis as any).crypto;
	const previousWindow = (globalThis as any).window;
	const previousWindowCrypto = previousWindow ? previousWindow.crypto : undefined;

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
	} as unknown as typeof globalThis.crypto;

	// Install the stub on globalThis and on window (if present) so browser-like
	// client tests that reference window.crypto continue to work.
	vi.stubGlobal('crypto', stubbedCrypto);
	if ((globalThis as any).window) {
		try {
			(globalThis as any).window.crypto = stubbedCrypto;
		} catch {
			// ignore immutability issues in some environments
		}
	}

	return function uninstall() {
		// Prefer to use vitest's unstubGlobal if available to remove the stub.
		try {
			if (typeof (vi as any).unstubGlobal === 'function') {
				(vi as any).unstubGlobal('crypto');
			}
		} catch {
			// ignore failures from vitest
		}

		// Restore globalThis.crypto and window.crypto to their previous values.
		try {
			if (previousCrypto === undefined) {
				try {
					delete (globalThis as any).crypto;
				} catch {
					(globalThis as any).crypto = undefined;
				}
			} else {
				(globalThis as any).crypto = previousCrypto;
			}
		} catch {
			// ignore
		}

		try {
			if (previousWindow) {
				try {
					previousWindow.crypto = previousWindowCrypto;
				} catch {
					// ignore
				}
			} else if ((globalThis as any).window && previousWindowCrypto === undefined) {
				// no previous window object, ensure we remove the stubbed crypto if set
				try {
					delete (globalThis as any).window.crypto;
				} catch {
					try {
						(globalThis as any).window.crypto = undefined;
					} catch {
						// ignore
					}
				}
			}
		} catch {
			// ignore
		}
	};
}
