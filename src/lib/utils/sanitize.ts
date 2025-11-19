/**
 * Sanitize HTML to prevent XSS attacks
 * @param html HTML string to sanitize
 * @returns Sanitized string
 */
export function sanitizeHtml(html: string): string {
	// Check if we're in a browser environment with a proper DOM
	if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
		return html;
	}

	const temp = document.createElement('div');
	temp.textContent = html;
	return temp.innerHTML;
}

/**
 * Validate and sanitize message content
 * @param content Message content
 * @param maxLength Maximum allowed length
 * @returns Sanitized content or null if invalid
 */
export function sanitizeMessage(content: string, maxLength: number = 5000): string | null {
	if (!content || typeof content !== 'string') {
		return null;
	}

	const trimmed = content.trim();

	if (trimmed.length === 0 || trimmed.length > maxLength) {
		return null;
	}

	// Remove any potentially dangerous content
	return sanitizeHtml(trimmed);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email);
}
