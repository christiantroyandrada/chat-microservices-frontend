/**
 * Unit tests for dev-logger
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock $app/environment
vi.mock('$app/environment', () => ({
	dev: true
}));

// Spy on console methods
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
const consoleGroupCollapsedSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
const consoleGroupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

const { logger } = await import('$lib/services/dev-logger');

describe('dev-logger', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('success', () => {
		it('should log success message', () => {
			logger.success('Test success', { data: 'test' });
			expect(consoleLogSpy).toHaveBeenCalled();
		});
	});

	describe('info', () => {
		it('should log info message', () => {
			logger.info('Test info', { data: 'test' });
			expect(consoleLogSpy).toHaveBeenCalled();
		});
	});

	describe('warning', () => {
		it('should log warning message', () => {
			logger.warning('Test warning', { data: 'test' });
			expect(consoleLogSpy).toHaveBeenCalled();
		});
	});

	describe('error', () => {
		it('should log error message', () => {
			logger.error('Test error', { data: 'test' });
			expect(consoleLogSpy).toHaveBeenCalled();
		});
	});

	describe('request', () => {
		it('should log request message with object', () => {
			logger.request('GET /api/users', { status: 200 });
			expect(consoleGroupCollapsedSpy).toHaveBeenCalled();
			expect(consoleGroupEndSpy).toHaveBeenCalled();
		});

		it('should log request message without object', () => {
			logger.request('GET /api/users');
			expect(consoleLogSpy).toHaveBeenCalled();
		});
	});

	describe('requestor', () => {
		it('should log requestor message with object', () => {
			logger.requestor(['Request', 'Details'], { method: 'POST' });
			expect(consoleGroupCollapsedSpy).toHaveBeenCalled();
			expect(consoleGroupEndSpy).toHaveBeenCalled();
		});

		it('should log requestor message without object', () => {
			logger.requestor(['Request', 'Details']);
			expect(consoleLogSpy).toHaveBeenCalled();
		});
	});

	describe('debug', () => {
		it('should log debug message with object', () => {
			logger.debug(['Debug', 'Info'], { value: 42 });
			expect(consoleGroupCollapsedSpy).toHaveBeenCalled();
			expect(consoleGroupEndSpy).toHaveBeenCalled();
		});

		it('should log debug message without object', () => {
			logger.debug(['Debug', 'Info']);
			expect(consoleLogSpy).toHaveBeenCalled();
		});
	});
});
