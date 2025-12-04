import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

// Mock navigation
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// Mock auth store to simulate unauthenticated state
vi.mock('$lib/stores/auth.store', () => ({
	authStore: {
		subscribe: (fn: (v: unknown) => void) => {
			fn({ user: null, loading: false, error: null });
			return () => {};
		},
		init: vi.fn().mockResolvedValue(undefined)
	},
	user: {
		subscribe: (fn: (v: unknown) => void) => {
			fn(null);
			return () => {};
		}
	}
}));

import RootPage from '../../../src/routes/+page.svelte';

describe('root +page route', () => {
	it('redirects to /login when unauthenticated', async () => {
		render(RootPage);
		const nav = await import('$app/navigation');
		expect(nav.goto).toHaveBeenCalledWith('/login');
	});
});
