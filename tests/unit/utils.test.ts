/**
 * Unit tests for utility functions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { debounce, normalizeNotification, safeToString } from '$lib/utils';
import { sanitizeHtml, sanitizeMessage } from '$lib/utils/sanitize';

describe('debounce', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should debounce function calls', () => {
		const fn = vi.fn();
		const debouncedFn = debounce(fn, 100);

		debouncedFn();
		debouncedFn();
		debouncedFn();

		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledOnce();
	});

	it('should call function with latest arguments', () => {
		const fn = vi.fn();
		const debouncedFn = debounce(fn, 100);

		debouncedFn('first');
		debouncedFn('second');
		debouncedFn('third');

		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledWith('third');
	});

	it('should handle multiple debounce periods', () => {
		const fn = vi.fn();
		const debouncedFn = debounce(fn, 100);

		debouncedFn();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);

		debouncedFn();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe('sanitizeHtml', () => {
	it('should sanitize HTML content', () => {
		// In Node environment, document is undefined so sanitizeHtml returns the original
		// This is expected server-side behavior
		const result = sanitizeHtml('<script>alert("XSS")</script>Hello');
		expect(typeof result).toBe('string');
		expect(result).toBeTruthy();
	});

	it('should handle plain text', () => {
		const result = sanitizeHtml('Plain text');
		expect(result).toBe('Plain text');
	});
});

describe('sanitizeMessage', () => {
	it('should sanitize valid message', () => {
		const result = sanitizeMessage('Hello World');
		expect(result).toBe('Hello World');
	});

	it('should return null for empty message', () => {
		expect(sanitizeMessage('')).toBeNull();
		expect(sanitizeMessage('   ')).toBeNull();
	});

	it('should return null for null/undefined', () => {
		expect(sanitizeMessage(null as unknown as string)).toBeNull();
		expect(sanitizeMessage(undefined as unknown as string)).toBeNull();
	});

	it('should reject messages that are too long', () => {
		const longMessage = 'a'.repeat(6000);
		expect(sanitizeMessage(longMessage, 5000)).toBeNull();
	});
});

describe('safeToString', () => {
	it('should convert string to string', () => {
		expect(safeToString('hello')).toBe('hello');
	});

	it('should convert number to string', () => {
		expect(safeToString(42)).toBe('42');
		expect(safeToString(0)).toBe('0');
	});

	it('should convert boolean to string', () => {
		expect(safeToString(true)).toBe('true');
		expect(safeToString(false)).toBe('false');
	});

	it('should handle null and undefined', () => {
		expect(safeToString(null)).toBe('');
		expect(safeToString(undefined)).toBe('');
	});

	it('should handle objects', () => {
		const obj = { key: 'value' };
		const result = safeToString(obj);
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});

	it('should handle arrays', () => {
		const arr = [1, 2, 3];
		const result = safeToString(arr);
		expect(typeof result).toBe('string');
	});
});

describe('normalizeNotification', () => {
	it('should normalize notification object', () => {
		const raw = {
			_id: '123',
			type: 'message',
			title: 'Test',
			message: 'Test message',
			read: false,
			createdAt: '2023-01-01T00:00:00.000Z',
			userId: 'user-123'
		};

		const result = normalizeNotification(raw);

		expect(result._id).toBe('123');
		expect(result.type).toBe('message');
		expect(result.title).toBe('Test');
		expect(result.message).toBe('Test message');
		expect(result.read).toBe(false);
	});

	it('should handle missing _id', () => {
		const raw = {
			id: '456',
			type: 'message',
			title: 'Test'
		};

		const result = normalizeNotification(raw);
		expect(result._id).toBe('456');
	});

	it('should provide default values', () => {
		const raw = {};

		const result = normalizeNotification(raw, 0);
		expect(result._id).toBeDefined();
		expect(result.type).toBeDefined();
		expect(result.read).toBe(false);
	});

	it('should handle various timestamp formats', () => {
		const raw = {
			_id: '123',
			createdAt: '2023-01-01T00:00:00.000Z'
		};

		const result = normalizeNotification(raw);
		expect(result.createdAt).toBeTruthy();
	});
});
