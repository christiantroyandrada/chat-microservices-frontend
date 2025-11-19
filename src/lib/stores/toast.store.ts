import { writable, type Writable, get } from 'svelte/store';
import type { Toast } from '$lib/types';

/**
 * Toast store implemented with a Svelte writable so it can be used
 * outside of `.svelte` files (rune-free).
 *
 * Usage in components:
 * - Reactive: `import { toastStore } from '$lib/stores/toast.store';` then use `$toastStore` in a .svelte file
 * - Imperative: `toastStore.items` returns a snapshot array
 */
class ToastStore {
	private readonly store: Writable<Toast[]> = writable([]);
	private nextId = 0;

	// Expose the subscribe method so this instance is a valid Svelte store
	subscribe: Writable<Toast[]>['subscribe'] = (run, invalidate?) =>
		this.store.subscribe(run, invalidate);

	/**
	 * Snapshot of current toasts (non-reactive). Use `items` when you need a one-off view.
	 */
	get items(): Toast[] {
		return get(this.store);
	}

	show(type: Toast['type'], message: string, duration: number = 5000): string {
		const id = `toast-${this.nextId++}`;
		const toast: Toast = { id, type, message, duration };

		this.store.update((ts) => [...ts, toast]);

		if (duration > 0) {
			setTimeout(() => this.dismiss(id), duration);
		}

		return id;
	}

	success(message: string, duration?: number) {
		return this.show('success', message, duration);
	}

	error(message: string, duration?: number) {
		return this.show('error', message, duration);
	}

	warning(message: string, duration?: number) {
		return this.show('warning', message, duration);
	}

	info(message: string, duration?: number) {
		return this.show('info', message, duration);
	}

	dismiss(id: string) {
		this.store.update((ts) => ts.filter((t) => t.id !== id));
	}

	clear() {
		this.store.set([]);
	}
}

export const toastStore = new ToastStore();
