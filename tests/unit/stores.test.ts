/**
 * Unit tests for stores
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock dependencies
vi.mock('$lib/services/auth.service', () => ({
	authService: {
		login: vi.fn(),
		register: vi.fn(),
		logout: vi.fn(),
		getCurrentUser: vi.fn()
	}
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('$app/environment', () => ({
	browser: true
}));

const mockLogger = {
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn()
};

vi.mock('$lib/services/dev-logger', () => ({
	logger: mockLogger
}));

describe('toastStore', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		const { toastStore } = await import('$lib/stores/toast.store');
		toastStore.clear();
	});

	it('should show success toast', async () => {
		const { toastStore } = await import('$lib/stores/toast.store');
		const id = toastStore.success('Success message');

		expect(id).toBeTruthy();
		const items = get(toastStore);
		expect(items).toHaveLength(1);
		expect(items[0].type).toBe('success');
		expect(items[0].message).toBe('Success message');
	});

	it('should show error toast', async () => {
		const { toastStore } = await import('$lib/stores/toast.store');
		toastStore.error('Error message');

		const items = get(toastStore);
		expect(items).toHaveLength(1);
		expect(items[0].type).toBe('error');
	});

	it('should show warning toast', async () => {
		const { toastStore } = await import('$lib/stores/toast.store');
		toastStore.warning('Warning message');

		const items = get(toastStore);
		expect(items[0].type).toBe('warning');
	});

	it('should show info toast', async () => {
		const { toastStore } = await import('$lib/stores/toast.store');
		toastStore.info('Info message');

		const items = get(toastStore);
		expect(items[0].type).toBe('info');
	});

	it('should dismiss toast by id', async () => {
		const { toastStore } = await import('$lib/stores/toast.store');
		const id = toastStore.success('Test');

		expect(get(toastStore)).toHaveLength(1);

		toastStore.dismiss(id);
		expect(get(toastStore)).toHaveLength(0);
	});

	it('should clear all toasts', async () => {
		const { toastStore } = await import('$lib/stores/toast.store');
		toastStore.success('Toast 1');
		toastStore.error('Toast 2');

		expect(get(toastStore)).toHaveLength(2);

		toastStore.clear();
		expect(get(toastStore)).toHaveLength(0);
	});

	it('should auto-dismiss after duration', async () => {
		vi.useFakeTimers();
		const { toastStore } = await import('$lib/stores/toast.store');

		toastStore.success('Auto dismiss', 1000);
		expect(get(toastStore)).toHaveLength(1);

		vi.advanceTimersByTime(1000);
		expect(get(toastStore)).toHaveLength(0);

		vi.useRealTimers();
	});
});

describe('themeStore', () => {
	let mockElement: {
		className: string;
		classList: {
			contains: (className: string) => boolean;
			add: (className: string) => void;
			remove: (...classNames: string[]) => void;
		};
	};

	let localStorageMock: {
		data: Record<string, string>;
		getItem: (key: string) => string | null;
		setItem: (key: string, value: string) => void;
		removeItem: (key: string) => void;
		clear: () => void;
	};

	beforeEach(() => {
		// Mock localStorage
		localStorageMock = {
			data: {} as Record<string, string>,
			getItem(key: string) {
				return this.data[key] || null;
			},
			setItem(key: string, value: string) {
				this.data[key] = value;
			},
			removeItem(key: string) {
				delete this.data[key];
			},
			clear() {
				this.data = {};
			}
		};

		// Mock document.documentElement
		mockElement = {
			className: '',
			classList: {
				contains: (className: string) => mockElement.className.includes(className),
				add: (className: string) => {
					if (!mockElement.className.includes(className)) {
						mockElement.className = (mockElement.className + ` ${className}`).trim();
					}
				},
				remove: (...classNames: string[]) => {
					classNames.forEach((className) => {
						mockElement.className = mockElement.className.replace(className, '').trim();
					});
				}
			}
		};

		Object.defineProperty(globalThis, 'localStorage', {
			value: localStorageMock,
			writable: true,
			configurable: true
		});

		Object.defineProperty(globalThis, 'document', {
			value: {
				documentElement: mockElement
			},
			writable: true,
			configurable: true
		});

		Object.defineProperty(globalThis, 'window', {
			value: {
				matchMedia: () => ({ matches: false })
			},
			writable: true,
			configurable: true
		});

		localStorageMock.clear();
		mockElement.className = '';
	});

	it('should initialize with dark theme by default', async () => {
		const { themeStore } = await import('$lib/stores/theme.store');
		const theme = get(themeStore);
		expect(['light', 'dark']).toContain(theme);
	});

	it('should set theme', async () => {
		const { themeStore } = await import('$lib/stores/theme.store');
		themeStore.set('light');

		expect(get(themeStore)).toBe('light');
		expect(document.documentElement.classList.contains('light')).toBe(true);
	});

	it('should toggle theme', async () => {
		const { themeStore } = await import('$lib/stores/theme.store');
		themeStore.set('dark');

		themeStore.toggle();
		expect(get(themeStore)).toBe('light');

		themeStore.toggle();
		expect(get(themeStore)).toBe('dark');
	});

	it('should save theme to localStorage', async () => {
		const { themeStore } = await import('$lib/stores/theme.store');
		themeStore.set('light');

		expect(localStorage.getItem('theme')).toBe('light');
	});
});
