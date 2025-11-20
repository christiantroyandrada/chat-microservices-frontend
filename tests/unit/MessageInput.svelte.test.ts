import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

import MessageInput from '$lib/components/MessageInput.svelte';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/stores/toast.store', () => ({
	toastStore: { subscribe: vi.fn(), error: vi.fn(), success: vi.fn(), clear: vi.fn() }
}));
vi.mock('$lib/services/dev-logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

describe('MessageInput component (typing debounce)', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('calls typing true on input and eventually calls typing false after debounce', async () => {
		vi.useFakeTimers();
		const send = vi.fn();
		const typing = vi.fn();

		const { container } = render(MessageInput, { send, typing, maxLength: 100 });
		const textarea = container.querySelector(
			'textarea[aria-label="Message input"]'
		) as HTMLTextAreaElement;
		await fireEvent.input(textarea, { target: { value: 'hello' } });

		// typing should be called with true immediately
		expect(typing).toHaveBeenCalledWith(true);

		// advance timers to trigger debounced stop typing (1000ms + margin)
		vi.advanceTimersByTime(1100);
		// allow any pending microtasks
		await Promise.resolve();

		expect(typing).toHaveBeenCalledWith(false);
		vi.useRealTimers();
	});
});
