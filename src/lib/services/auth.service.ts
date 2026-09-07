import { userApi } from './api.generated';
import { logger } from './dev-logger';
import type { LoginCredentials, RegisterCredentials, User, EncryptedKeyBundle } from '$lib/types';
import type { UserApiUser } from '$lib/generated/api.types';
import { ContractBoundaryError, assertNonEmptyString, assertObject } from './contract-boundary';

function assertValidUser(data: unknown, context: string): UserApiUser {
	const obj = assertObject(data, context, 'data');
	const id = assertNonEmptyString((obj as Record<string, unknown>).id, context, 'id');
	const username = assertNonEmptyString(
		(obj as Record<string, unknown>).username,
		context,
		'username'
	);
	const email = assertNonEmptyString((obj as Record<string, unknown>).email, context, 'email');
	return { id, username, email } as UserApiUser;
}

function toUser(validated: UserApiUser): User {
	return {
		_id: validated.id,
		username: validated.username,
		email: validated.email
	};
}

function assertEncryptedBundle(value: unknown, context: string): EncryptedKeyBundle {
	const obj = assertObject(value, context, 'encryptedBundle');
	const encrypted = assertNonEmptyString(
		(obj as Record<string, unknown>).encrypted,
		context,
		'encryptedBundle.encrypted'
	);
	const iv = assertNonEmptyString(
		(obj as Record<string, unknown>).iv,
		context,
		'encryptedBundle.iv'
	);
	const salt = assertNonEmptyString(
		(obj as Record<string, unknown>).salt,
		context,
		'encryptedBundle.salt'
	);
	const versionRaw = (obj as Record<string, unknown>).version;
	if (typeof versionRaw !== 'number' || !Number.isFinite(versionRaw)) {
		throw new ContractBoundaryError(`${context}: encryptedBundle.version must be finite number`);
	}
	const deviceId = assertNonEmptyString(
		(obj as Record<string, unknown>).deviceId,
		context,
		'encryptedBundle.deviceId'
	);
	return { encrypted, iv, salt, version: versionRaw, deviceId };
}

export const authService = {
	/**
	 * Register a new user
	 */
	async register(credentials: RegisterCredentials): Promise<User> {
		// Normalize username to a safe handle and validate format before sending to backend
		const normalizedUsername = String(credentials.username || '')
			.replaceAll('\u00A0', ' ')
			.replaceAll(/[\s\uFEFF\xA0]+/g, ' ')
			.trim()
			.toLowerCase();

		// Client-side validation: letters, numbers, underscores, hyphens; 3-30 chars
		const usernameRegex = /^[a-z0-9_-]{3,30}$/;
		if (!usernameRegex.test(normalizedUsername)) {
			throw new Error('Invalid username. Use 3-30 characters: letters, numbers, _ or -');
		}

		const payload = {
			username: normalizedUsername,
			email: credentials.email,
			password: credentials.password
		};

		// backend exposes registration at /register on the user router which is mounted
		// under /api/user by the gateway/nginx. Use the full path here.
		const response = await userApi.register(payload);

		// Token is sent via httpOnly cookie (not in response body)
		// No need to extract or store token manually

		const validated = assertValidUser(response.data, 'user.register');
		return toUser(validated);
	},

	/**
	 * Login user
	 */
	async login(credentials: LoginCredentials): Promise<void> {
		await userApi.login(credentials);

		// Token is sent via httpOnly cookie (not in response body)
		// No need to extract or store token manually
	},

	/**
	 * Logout user
	 */
	async logout(): Promise<void> {
		// Call backend logout to clear httpOnly cookie, then clear any UI state
		await userApi.logout();
		if (globalThis.window !== undefined) {
			// remove any temporary client-side caches
			try {
				localStorage.removeItem('user');
			} catch (e) {
				logger.warning('Failed to remove user from localStorage', e);
			}
		}
	},

	/**
	 * Get current user profile
	 */
	async getCurrentUser(): Promise<User> {
		const response = await userApi.getCurrentUser();
		const validated = assertValidUser(response.data, 'user.getCurrentUser');
		return toUser(validated);
	},

	/**
	 * Store encrypted Signal Protocol keys on the backend for persistence across devices/tabs
	 * Keys are encrypted CLIENT-SIDE before transmission - server never sees plaintext keys
	 */
	async storeSignalKeys(deviceId: string, encryptedBundle: EncryptedKeyBundle): Promise<void> {
		await userApi.storeSignalKeys({ deviceId, encryptedBundle });
	},

	/**
	 * Fetch encrypted Signal Protocol keys from the backend
	 * Returns null if no keys are stored
	 * Keys must be decrypted CLIENT-SIDE after retrieval
	 */
	async fetchSignalKeys(deviceId: string): Promise<EncryptedKeyBundle | null> {
		try {
			const response = await userApi.fetchSignalKeys(deviceId);
			if (response.data == null) {
				throw new ContractBoundaryError('user.fetchSignalKeys: data is required');
			}
			const dataObj = assertObject(response.data, 'user.fetchSignalKeys', 'data');
			const bundleRaw = (dataObj as Record<string, unknown>).encryptedBundle;
			if (bundleRaw == null) {
				throw new ContractBoundaryError('user.fetchSignalKeys: encryptedBundle is required');
			}
			return assertEncryptedBundle(bundleRaw, 'user.fetchSignalKeys');
		} catch (error: unknown) {
			if (error instanceof ContractBoundaryError) {
				throw error;
			}
			// 404 means no keys stored yet - this is expected for new users
			if (typeof error === 'object' && error !== null) {
				const httpError = error as { status?: number; response?: { status?: number } };
				if (httpError.status === 404 || httpError.response?.status === 404) {
					return null;
				}
			}
			throw error;
		}
	}

	// Deprecated client-side token helpers removed. Authentication is verified
	// by calling `getCurrentUser()` which relies on httpOnly cookies sent by
	// the server. Any token storage in localStorage (e.g. `auth_token`) has
	// been removed from the codebase.
};
