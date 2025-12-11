/**
 * Client-Side Key Encryption Utilities
 *
 * Implements Option 2: Client-Side Encrypted Key Backup
 *
 * Security Features:
 * - Uses Web Crypto API for encryption (AES-256-GCM)
 * - Derives encryption key from user password using PBKDF2 (100,000 iterations)
 * - Random salt and IV for each encryption
 * - Authenticated encryption (GCM mode prevents tampering)
 * - Server never sees plaintext keys
 * - Session-based key caching for page refresh persistence
 */

import type { SignalKeySet, EncryptedKeyBundle } from '$lib/types';
import { logger } from '$lib/services/dev-logger';

const ENCRYPTION_VERSION = 1;
const PBKDF2_ITERATIONS = 100000; // OWASP recommended minimum
const KEY_LENGTH = 256; // AES-256
const SESSION_KEY_NAME = '_ek'; // Encryption key cache in sessionStorage

/**
 * Derive encryption key from user password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	const passwordBuffer = encoder.encode(password);

	// Import password as key material
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		passwordBuffer,
		{ name: 'PBKDF2' },
		false,
		['deriveKey']
	);

	// Derive AES-GCM key from password
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: salt as BufferSource, // Type assertion for Web Crypto API
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		keyMaterial,
		{ name: 'AES-GCM', length: KEY_LENGTH },
		false, // Not extractable
		['encrypt', 'decrypt']
	);
}

/**
 * Cache password in sessionStorage for key restoration after page refresh
 *
 * Security considerations:
 * - sessionStorage is cleared when browser tab is closed
 * - Only accessible from same origin
 * - Still vulnerable to XSS attacks, but mitigated by CSP
 * - Better security than localStorage (no persistence across sessions)
 * - Enables seamless E2E key restoration on page refresh within same session
 *
 * @param password - User password to cache
 */
export function cacheEncryptionPassword(password: string): void {
	try {
		if (typeof sessionStorage !== 'undefined') {
			// Store password obfuscated (not secure encryption, just obfuscation)
			// Real security comes from sessionStorage isolation and tab-close clearing
			const obfuscated = btoa(encodeURIComponent(password));
			sessionStorage.setItem(SESSION_KEY_NAME, obfuscated);
			logger.info('[KeyEncryption] Encryption key cached in session storage');
		}
	} catch (error) {
		logger.warning('[KeyEncryption] Failed to cache encryption key:', error);
	}
}

/**
 * Retrieve cached password from sessionStorage
 *
 * @returns Cached password or null if not available
 */
export function getCachedEncryptionPassword(): string | null {
	try {
		if (typeof sessionStorage !== 'undefined') {
			const obfuscated = sessionStorage.getItem(SESSION_KEY_NAME);
			if (obfuscated) {
				const password = decodeURIComponent(atob(obfuscated));
				logger.info('[KeyEncryption] Retrieved cached encryption key from session storage');
				return password;
			}
		}
	} catch (error) {
		logger.warning('[KeyEncryption] Failed to retrieve cached encryption key:', error);
	}
	return null;
}

/**
 * Clear cached password from sessionStorage
 */
export function clearCachedEncryptionPassword(): void {
	try {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.removeItem(SESSION_KEY_NAME);
			logger.info('[KeyEncryption] Cleared cached encryption key');
		}
	} catch (error) {
		logger.warning('[KeyEncryption] Failed to clear cached encryption key:', error);
	}
}

/**
 * Convert ArrayBuffer to Base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCodePoint(bytes[i]);
	}
	return btoa(binary);
}

/**
 * Convert Base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.codePointAt(i)!;
	}
	return bytes.buffer;
}

/**
 * Encrypt Signal key set with user password
 *
 * @param keySet - Plaintext Signal keys to encrypt
 * @param password - User password for encryption
 * @param deviceId - Device ID for key isolation
 * @returns Encrypted bundle safe for backend storage
 */
export async function encryptKeySet(
	keySet: SignalKeySet,
	password: string,
	deviceId: string
): Promise<EncryptedKeyBundle> {
	logger.info('[KeyEncryption] Encrypting key set for device:', deviceId);

	// Generate random salt and IV
	const salt = crypto.getRandomValues(new Uint8Array(32));
	const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM

	// Derive encryption key from password
	const encryptionKey = await deriveKey(password, salt);

	// Encrypt key set with AES-256-GCM
	const encoder = new TextEncoder();
	const plaintext = encoder.encode(JSON.stringify(keySet));

	const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, plaintext);

	logger.info('[KeyEncryption] Encryption successful', {
		encryptedSize: encrypted.byteLength,
		version: ENCRYPTION_VERSION
	});

	return {
		encrypted: arrayBufferToBase64(encrypted),
		iv: arrayBufferToBase64(iv.buffer),
		salt: arrayBufferToBase64(salt.buffer),
		version: ENCRYPTION_VERSION,
		deviceId
	};
}

/**
 * Decrypt Signal key set with user password
 *
 * @param bundle - Encrypted key bundle from backend
 * @param password - User password for decryption
 * @returns Decrypted Signal keys
 * @throws Error if decryption fails (wrong password or tampered data)
 */
export async function decryptKeySet(
	bundle: EncryptedKeyBundle,
	password: string
): Promise<SignalKeySet> {
	logger.info('[KeyEncryption] Decrypting key set for device:', bundle.deviceId);

	// Check version compatibility
	if (bundle.version !== ENCRYPTION_VERSION) {
		throw new Error(`Unsupported encryption version: ${bundle.version}`);
	}

	// Convert base64 to ArrayBuffers
	const encrypted = base64ToArrayBuffer(bundle.encrypted);
	const iv = new Uint8Array(base64ToArrayBuffer(bundle.iv));
	const salt = new Uint8Array(base64ToArrayBuffer(bundle.salt));

	// Derive decryption key from password
	const decryptionKey = await deriveKey(password, salt);

	try {
		// Decrypt with AES-256-GCM
		const decrypted = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv },
			decryptionKey,
			encrypted
		);

		const decoder = new TextDecoder();
		const json = decoder.decode(decrypted);
		const keySet = JSON.parse(json) as SignalKeySet;

		logger.info('[KeyEncryption] Decryption successful');
		return keySet;
	} catch (error) {
		logger.error('[KeyEncryption] Decryption failed:', error);
		throw new Error('Failed to decrypt keys. Wrong password or corrupted data.');
	}
}

/**
 * Validate password strength
 *
 * Minimum requirements (aligned with backend authValidation.ts):
 * - At least 8 characters
 * - Contains uppercase and lowercase
 * - Contains numbers
 * - Contains special characters (@$!%*?&)
 *
 * NOTE: This aligns with user-service/src/middleware/validation/authValidation.ts
 */
export function validatePasswordStrength(password: string): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	if (password.length < 8) {
		errors.push('Password must be at least 8 characters long');
	}

	if (!/[a-z]/.test(password)) {
		errors.push('Password must contain lowercase letters');
	}

	if (!/[A-Z]/.test(password)) {
		errors.push('Password must contain uppercase letters');
	}

	if (!/\d/.test(password)) {
		errors.push('Password must contain numbers');
	}

	if (!/[@$!%*?&]/.test(password)) {
		errors.push('Password must contain special characters (@$!%*?&)');
	}

	return {
		valid: errors.length === 0,
		errors
	};
}
