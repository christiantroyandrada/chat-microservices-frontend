import { writable } from 'svelte/store';
import type { Toast } from '$lib/types';

function createToastStore() {
	const { subscribe, update } = writable<Toast[]>([]);

	let nextId = 0;

	return {
		subscribe,

		/**
		 * Show a toast notification
		 */
		show(
			type: Toast['type'],
			message: string,
			duration: number = 5000
		): string {
			const id = `toast-${nextId++}`;
			const toast: Toast = { id, type, message, duration };

			update((toasts) => [...toasts, toast]);

			if (duration > 0) {
				setTimeout(() => {
					this.dismiss(id);
				}, duration);
			}

			return id;
		},

		/**
		 * Show success toast
		 */
		success(message: string, duration?: number): string {
			return this.show('success', message, duration);
		},

		/**
		 * Show error toast
		 */
		error(message: string, duration?: number): string {
			return this.show('error', message, duration);
		},

		/**
		 * Show warning toast
		 */
		warning(message: string, duration?: number): string {
			return this.show('warning', message, duration);
		},

		/**
		 * Show info toast
		 */
		info(message: string, duration?: number): string {
			return this.show('info', message, duration);
		},

		/**
		 * Dismiss a specific toast
		 */
		dismiss(id: string): void {
			update((toasts) => toasts.filter((t) => t.id !== id));
		},

		/**
		 * Clear all toasts
		 */
		clear(): void {
			update(() => []);
		}
	};
}

export const toastStore = createToastStore();
