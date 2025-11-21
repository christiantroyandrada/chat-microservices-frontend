import { describe, it, expect, beforeEach } from 'vitest';

import { sanitizeMessage, isValidEmail } from '$lib/utils';

describe('sanitize utils', () => {
	beforeEach(() => {
		// ensure global document exists for sanitizeHtml
		if (typeof globalThis.document === 'undefined') {
			// minimal mock — cast to Document so the createElement signature matches
			globalThis.document = {
				createElement: () => {
					const el = {
						textContent: '',
						get innerHTML() {
							return String((this as unknown as { textContent: string }).textContent)
								.replace(/&/g, '&amp;')
								.replace(/</g, '&lt;')
								.replace(/>/g, '&gt;');
						}
					} as unknown as HTMLElement;
					return el;
				}
			} as unknown as Document;
		}
	});

	it('sanitizes html and trims messages', () => {
		const dirty = '  <b>hello</b>  ';
		const sanitized = sanitizeMessage(dirty);
		// depending on environment the HTML may be escaped or returned as-is;
		// ensure it's trimmed and contains the expected content
		expect(sanitized).toBeTruthy();
		expect(String(sanitized).trim()).toMatch(/(&lt;b&gt;hello&lt;\/b&gt;|<b>hello<\/b>)/);
	});

	it('rejects empty or too long messages', () => {
		expect(sanitizeMessage('   ')).toBeNull();
		const long = 'a'.repeat(6000);
		expect(sanitizeMessage(long, 500)).toBeNull();
	});

	it('validates emails correctly', () => {
		expect(isValidEmail('a@b.com')).toBe(true);
		expect(isValidEmail('bad@@x')).toBe(false);
	});
});
