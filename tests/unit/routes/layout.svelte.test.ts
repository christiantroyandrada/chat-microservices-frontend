import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import Layout from '../../../src/routes/+layout.svelte';
import type { Page } from '@sveltejs/kit';

// Small helper to construct a typed Page object for tests. We cast via
// unknown to avoid needing to perfectly mirror SvelteKit's evolving Page
// internals (state/form) while keeping the shape the component expects.
function createPage(pathname: string): Page {
	return {
		url: new URL(`http://localhost${pathname}`),
		params: {},
		route: { id: null },
		status: 200,
		error: null,
		data: {}
	} as unknown as Page;
}

// Mock stores and components
vi.mock('$app/stores', () => ({
	['page']: {
		subscribe: vi.fn((callback) => {
			callback(createPage('/'));
			return () => {};
		})
	}
}));

vi.mock('$lib/stores/auth.store', () => ({
	authStore: {
		init: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn((callback) => {
			callback(null);
			return () => {};
		})
	}
}));

vi.mock('$lib/components/Toast.svelte', () => {
	return {
		default: vi.fn()
	};
});

vi.mock('$lib/components/ThemeToggle.svelte', () => {
	return {
		default: vi.fn()
	};
});

describe('Layout component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('renders children slot', () => {
		const { container } = render(Layout);
		expect(container).toBeTruthy();
	});

	it('initializes auth on mount for non-auth pages', async () => {
		const mockInit = vi.fn().mockResolvedValue(undefined);
		const { authStore } = await import('$lib/stores/auth.store');
		authStore.init = mockInit;

		render(Layout);

		// Wait for onMount to complete
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(mockInit).toHaveBeenCalled();
	});

	it('does not initialize auth on login page', async () => {
		const mockInit = vi.fn();
		const { authStore } = await import('$lib/stores/auth.store');
		authStore.init = mockInit;

		const appStores = await import('$app/stores');
		const mockPage = vi.mocked(appStores['page']);
		mockPage.subscribe = vi.fn((callback) => {
			callback(createPage('/login'));
			return () => {};
		});

		render(Layout);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(mockInit).not.toHaveBeenCalled();
	});

	it('does not initialize auth on register page', async () => {
		const mockInit = vi.fn();
		const { authStore } = await import('$lib/stores/auth.store');
		authStore.init = mockInit;

		const appStores = await import('$app/stores');
		const mockPage = vi.mocked(appStores['page']);
		mockPage.subscribe = vi.fn((callback) => {
			callback(createPage('/register'));
			return () => {};
		});

		render(Layout);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(mockInit).not.toHaveBeenCalled();
	});
});
