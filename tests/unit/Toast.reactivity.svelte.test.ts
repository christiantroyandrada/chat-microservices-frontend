/**
 * Regression tests: Toast must react to store changes after mount.
 *
 * The component previously iterated `toastStore.items` — a non-reactive
 * `get(store)` snapshot — so toasts fired after hydration never appeared
 * and existing ones never dismissed. The template must use `$toastStore`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitForElementToBeRemoved } from '@testing-library/svelte';
import { tick } from 'svelte';
import Toast from '$lib/components/Toast.svelte';
import { toastStore } from '$lib/stores/toast.store';

describe('Toast reactivity', () => {
	beforeEach(() => {
		toastStore.clear();
	});

	afterEach(() => {
		toastStore.clear();
	});

	it('shows a toast fired after mount', async () => {
		render(Toast);
		toastStore.success('Fired after mount', 0);
		await tick();
		expect(screen.getByText('Fired after mount')).toBeTruthy();
	});

	it('removes a toast when dismissed', async () => {
		const id = toastStore.info('Short-lived', 0);
		render(Toast);
		expect(screen.getByText('Short-lived')).toBeTruthy();
		toastStore.dismiss(id);
		// fly out-transition keeps the node around briefly; wait for removal
		await waitForElementToBeRemoved(() => screen.queryByText('Short-lived'));
		expect(screen.queryByText('Short-lived')).toBeNull();
	});

	it('stacks toasts fired after mount and keeps earlier ones', async () => {
		render(Toast);
		toastStore.error('First', 0);
		await tick();
		toastStore.warning('Second', 0);
		await tick();
		expect(screen.getByText('First')).toBeTruthy();
		expect(screen.getByText('Second')).toBeTruthy();
	});
});
