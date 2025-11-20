/**
 * Unit tests for Toast component
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Toast from '$lib/components/Toast.svelte';
import { toastStore } from '$lib/stores/toast.store';

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

describe('Toast Component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		toastStore.clear();
	});

	afterEach(() => {
		toastStore.clear();
	});

	it('should render toast with message', () => {
		toastStore.success('Test message');
		render(Toast);
		expect(screen.getByText('Test message')).toBeTruthy();
	});

	it('should render success toast with correct icon', () => {
		toastStore.clear();
		toastStore.success('Success message');
		const { container } = render(Toast);
		expect(screen.getByText('Success message')).toBeTruthy();
		const icons = container.querySelectorAll('.text-xl.font-bold');
		const successIcon = Array.from(icons).find((el) => el.textContent === '✓');
		expect(successIcon).toBeTruthy();
	});

	it('should render error toast', () => {
		toastStore.clear();
		toastStore.error('Error message');
		const { container } = render(Toast);
		expect(screen.getByText('Error message')).toBeTruthy();
		const icons = container.querySelectorAll('.text-xl.font-bold');
		const errorIcon = Array.from(icons).find((el) => el.textContent === '✕');
		expect(errorIcon).toBeTruthy();
	});

	it('should render warning toast', () => {
		toastStore.warning('Warning message');
		render(Toast);
		expect(screen.getByText('Warning message')).toBeTruthy();
		expect(screen.getByText('⚠')).toBeTruthy();
	});

	it('should render info toast', () => {
		toastStore.info('Info message');
		render(Toast);
		expect(screen.getByText('Info message')).toBeTruthy();
		expect(screen.getByText('ℹ')).toBeTruthy();
	});

	it('should render multiple toasts', () => {
		toastStore.success('Message 1');
		toastStore.error('Message 2');
		render(Toast);
		expect(screen.getByText('Message 1')).toBeTruthy();
		expect(screen.getByText('Message 2')).toBeTruthy();
	});

	it('should have close button for each toast', () => {
		toastStore.success('Test message');
		const { container } = render(Toast);
		const closeButtons = container.querySelectorAll('button[aria-label="Close"]');
		expect(closeButtons.length).toBe(1);
	});
});
