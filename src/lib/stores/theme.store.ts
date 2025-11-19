import { writable } from 'svelte/store';
import type { Theme } from '$lib/types';
const STORAGE_KEY = 'theme';

const isBrowser = typeof globalThis.window !== 'undefined';

const initial = (() => {
	if (!isBrowser) return 'dark';
	const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
	if (saved) return saved;
	// prefer user's system preference
	const prefersLight =
		globalThis.window.matchMedia &&
		globalThis.window.matchMedia('(prefers-color-scheme: light)').matches;
	return prefersLight ? 'light' : 'dark';
})();

const { subscribe, set, update } = writable<Theme>(initial);

function applyTheme(theme: Theme) {
	if (!isBrowser) return;
	const el = document.documentElement;
	el.classList.remove('light', 'dark');
	el.classList.add(theme);
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// ignore
	}
}

// initialize immediately in browser
if (isBrowser) applyTheme(initial);

export const themeStore = {
	subscribe,
	set: (t: Theme) => {
		set(t);
		applyTheme(t);
	},
	toggle: () =>
		update((t) => {
			const next = t === 'dark' ? 'light' : 'dark';
			applyTheme(next);
			return next;
		})
};
