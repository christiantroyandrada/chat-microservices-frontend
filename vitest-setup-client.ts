/// <reference types="@vitest/browser/matchers" />
/// <reference types="@vitest/browser/providers/playwright" />

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

// Unmount everything a test rendered before the next test runs. The suite
// shares one page per file (singleFork), so without this, components leak
// across tests and reactive instances re-render alongside the current one.
afterEach(() => {
	cleanup();
});
