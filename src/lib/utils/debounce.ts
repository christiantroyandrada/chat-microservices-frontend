/**
 * Debounce function to limit the rate at which a function can fire
 * @param fn Function to debounce
 * @param delay Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout>;

	return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			// Use a safe cast without introducing `any` token
			const fnSafe = fn as unknown as (...a: Parameters<T>) => unknown;
			fnSafe.apply(this as unknown, args);
		}, delay);
	};
}

/**
 * Throttle function to ensure a function is called at most once per interval
 * @param fn Function to throttle
 * @param limit Time limit in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
	fn: T,
	limit: number
): (...args: Parameters<T>) => void {
	let inThrottle: boolean;

	return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
		if (!inThrottle) {
			const fnSafe = fn as unknown as (...a: Parameters<T>) => unknown;
			fnSafe.apply(this as unknown, args);
			inThrottle = true;
			setTimeout(() => (inThrottle = false), limit);
		}
	};
}
