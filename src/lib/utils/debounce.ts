/**
 * Debounce function to limit the rate at which a function can fire
 * @param fn Function to debounce
 * @param delay Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends unknown[]>(
	fn: (...args: T) => unknown,
	delay: number
): (...args: T) => void {
	let timeoutId: ReturnType<typeof setTimeout>;

	return function (this: unknown, ...args: T) {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			try {
				(fn as (...a: T) => unknown).apply(this, args);
			} catch (e) {
				// swallow errors inside debounced fn to avoid unhandled rejections
				// caller should handle errors inside their async fn if needed
				console.error('debounce wrapped function threw', e);
			}
		}, delay);
	};
}

/**
 * Throttle function to ensure a function is called at most once per interval
 * @param fn Function to throttle
 * @param limit Time limit in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends unknown[]>(
	fn: (...args: T) => unknown,
	limit: number
): (...args: T) => void {
	let inThrottle: boolean;

	return function (this: unknown, ...args: T) {
		if (!inThrottle) {
			try {
				(fn as (...a: T) => unknown).apply(this, args);
			} catch (e) {
				console.error('throttle wrapped function threw', e);
			}
			inThrottle = true;
			setTimeout(() => (inThrottle = false), limit);
		}
	};
}
