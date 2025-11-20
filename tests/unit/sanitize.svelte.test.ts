/**
 * Unit tests for sanitize utility functions (Browser environment)
 * These tests require DOM APIs and must run in browser environment
 */

import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeMessage } from '$lib/utils/sanitize';

describe('sanitizeHtml', () => {
	it('should sanitize HTML content', () => {
		const result = sanitizeHtml('<script>alert("XSS")</script>Hello');
		expect(typeof result).toBe('string');
		// In browser environment, script tags should be escaped
		expect(result).not.toContain('<script>');
		expect(result).toContain('Hello');
	});

	it('should handle plain text', () => {
		const result = sanitizeHtml('Plain text');
		expect(result).toBe('Plain text');
	});

	it('should escape HTML entities', () => {
		const result = sanitizeHtml('<div>Test</div>');
		expect(result).toContain('&lt;');
		expect(result).toContain('&gt;');
	});
});

describe('sanitizeMessage', () => {
	it('should sanitize valid message', () => {
		const result = sanitizeMessage('Hello World');
		expect(result).toBe('Hello World');
	});

	it('should sanitize HTML in messages', () => {
		const result = sanitizeMessage('<script>alert("XSS")</script>Safe');
		expect(result).not.toContain('<script>');
	});
});
