/**
 * Shared Application Configuration
 *
 * Centralizes environment-dependent values and device identity management.
 * Prevents DRY violations across routes and services.
 *
 * @module config
 */

import { env } from '$env/dynamic/public';

/** Base URL for backend API calls */
export const API_BASE: string = env.PUBLIC_API_URL || 'http://localhost:80';

/** CDN URL for the application logo */
export const LOGO_URL =
	'https://res.cloudinary.com/dpqt9h7cn/image/upload/v1764081536/logo_blqxwc.png';

/** localStorage key (namespaced to avoid collisions on shared origins) */
const DEVICE_ID_KEY = 'chatapp_deviceId';

/**
 * Get or create a stable device identifier.
 *
 * Uses crypto.randomUUID() when available, falls back to a timestamp-based ID.
 * The value is persisted in localStorage so it survives page reloads.
 */
export function getOrCreateDeviceId(): string {
	if (typeof localStorage === 'undefined') {
		// SSR fallback — should never be called server-side, but be safe
		return `ssr-${Date.now()}`;
	}

	// Migrate from old un-namespaced key if present
	const legacy = localStorage.getItem('deviceId');
	if (legacy) {
		localStorage.setItem(DEVICE_ID_KEY, legacy);
		localStorage.removeItem('deviceId');
		return legacy;
	}

	let deviceId = localStorage.getItem(DEVICE_ID_KEY);
	if (!deviceId) {
		deviceId =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
		localStorage.setItem(DEVICE_ID_KEY, deviceId);
	}
	return deviceId;
}

/**
 * Minimum milliseconds between backup attempts.
 *
 * The server enforces a 24-hour rate limit.  This client-side guard avoids
 * running expensive PBKDF2 key derivation (100 k iterations) only to receive
 * a 429 response.  The window is deliberately shorter than the server limit
 * so a legitimate retry is still possible after a restart.
 */
export const BACKUP_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

const LAST_BACKUP_KEY = 'chatapp_lastBackupTs';

/** Record a successful backup timestamp */
export function markBackupDone(): void {
	try {
		sessionStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
	} catch {
		/* private/incognito — ignore */
	}
}

/** Check whether a backup attempt should be skipped */
export function shouldSkipBackup(): boolean {
	try {
		const ts = sessionStorage.getItem(LAST_BACKUP_KEY);
		if (!ts) return false;
		return Date.now() - Number(ts) < BACKUP_COOLDOWN_MS;
	} catch {
		return false;
	}
}
