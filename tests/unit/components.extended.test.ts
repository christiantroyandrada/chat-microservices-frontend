import { it } from 'vitest';

// This file was previously a browser-only test. The browser-targeted version
// lives at `components.extended.svelte.test.ts`. Keep a tiny noop test here
// to avoid running DOM-reliant code in the Node (server) test project.
it('noop', () => {
	// intentionally empty
});
