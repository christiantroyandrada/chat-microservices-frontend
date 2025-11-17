/**
 * Signal Protocol Utility Functions
 *
 * Helper functions for encoding/decoding and data conversion
 *
 * @module crypto/signalUtils
 */

/**
 * Convert ArrayBuffer to Base64 string
 * Used for encoding binary keys for network transmission
 * @param buffer - ArrayBuffer to convert
 * @returns Base64 encoded string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * Convert Base64 string to ArrayBuffer
 * Used for decoding keys received from network
 * @param base64 - Base64 encoded string
 * @returns Decoded ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

/**
 * Compare two ArrayBuffers for equality
 * @param a - First ArrayBuffer
 * @param b - Second ArrayBuffer
 * @returns True if buffers contain identical byte sequences
 */
export function arrayBufferEquals(a: ArrayBuffer, b: ArrayBuffer): boolean {
	const aView = new Uint8Array(a);
	const bView = new Uint8Array(b);
	if (aView.length !== bView.length) return false;
	for (let i = 0; i < aView.length; i++) {
		if (aView[i] !== bView[i]) return false;
	}
	return true;
}
