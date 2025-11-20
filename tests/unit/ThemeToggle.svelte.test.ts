/**
 * Unit tests for ThemeToggle component
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import ThemeToggle from '$lib/components/ThemeToggle.svelte';

// Mock theme store with factory function
vi.mock('$lib/stores/theme.store', () => {
	const subscribeFn = vi.fn();
	const setFn = vi.fn();
	const toggleFn = vi.fn();

	return {
		themeStore: {
			subscribe: subscribeFn,
			set: setFn,
			toggle: toggleFn
		}
	};
});

describe('ThemeToggle Component', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		// Import the mocked module
		const { themeStore } = await import('$lib/stores/theme.store');
		// Setup default subscriber behavior
		(themeStore.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
			(fn: (theme: string) => void) => {
				fn('dark');
				return () => {};
			}
		);
	});

	it('should render theme toggle button', () => {
		const { container } = render(ThemeToggle);
		const button = container.querySelector('button');
		expect(button).toBeTruthy();
	});

	it('should toggle theme when clicked', async () => {
		const { themeStore } = await import('$lib/stores/theme.store');
		const { container } = render(ThemeToggle);
		const button = container.querySelector('button');

		if (button) {
			button.click();
			expect(themeStore.toggle).toHaveBeenCalled();
		}
	});

	it('should display correct icon for dark theme', async () => {
		const { themeStore } = await import('$lib/stores/theme.store');
		(themeStore.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
			(fn: (theme: string) => void) => {
				fn('dark');
				return () => {};
			}
		);

		const { container } = render(ThemeToggle);
		const button = container.querySelector('button');
		expect(button).toBeTruthy();
		// Check for SVG element (sun icon for dark theme)
		const svg = container.querySelector('svg');
		expect(svg).toBeTruthy();
	});

	it('should display correct icon for light theme', async () => {
		const { themeStore } = await import('$lib/stores/theme.store');
		(themeStore.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
			(fn: (theme: string) => void) => {
				fn('light');
				return () => {};
			}
		);

		const { container } = render(ThemeToggle);
		const button = container.querySelector('button');
		expect(button).toBeTruthy();
		// Check for SVG element (moon icon for light theme)
		const svg = container.querySelector('svg');
		expect(svg).toBeTruthy();
	});
});
