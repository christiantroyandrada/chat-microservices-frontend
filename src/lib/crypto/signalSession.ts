/**
 * Signal Protocol Session Management
 *
 * Handles session establishment, message encryption/decryption
 *
 * @module crypto/signalSession
 */

import {
	SignalProtocolAddress,
	SessionBuilder,
	SessionCipher,
	EncryptionResultMessageType
} from '@privacyresearch/libsignal-protocol-typescript';
import type { DeviceType } from '@privacyresearch/libsignal-protocol-typescript';
import type { PrekeyBundleData, PrekeyBundlePayload, EncryptedMessage } from './types';
import { IndexedDBSignalProtocolStore } from './signalStore';
import { base64ToArrayBuffer, arrayBufferToBase64 } from './signalUtils';
import { DEFAULT_DEVICE_ID } from './signalConstants';
import { logger } from '$lib/services/dev-logger';

/**
 * Create a Signal Protocol session with a remote user's prekey bundle
 *
 * @param store - IndexedDB store instance
 * @param prekeyBundle - Remote user's prekey bundle from server
 */
export async function createSessionWithPrekeyBundle(
	store: IndexedDBSignalProtocolStore,
	prekeyBundle: unknown
): Promise<void> {
	// Narrow unknown payload to expected shape with runtime validation
	const payload = prekeyBundle as PrekeyBundlePayload;
	const bundleData: PrekeyBundleData = payload?.bundle ?? (prekeyBundle as PrekeyBundleData);
	const userId = payload?.userId ?? bundleData.userId ?? 'unknown';

	logger.info('[SignalSession] Creating session with prekey bundle:', {
		userId,
		hasIdentityKey: !!bundleData.identityKey,
		hasSignedPreKey: !!bundleData.signedPreKey,
		hasPreKeys: Array.isArray(bundleData.preKeys) && bundleData.preKeys.length > 0,
		registrationId: bundleData.registrationId
	});

	// Validate required fields
	if (typeof bundleData.identityKey !== 'string' || typeof bundleData.registrationId !== 'number') {
		throw new TypeError('Invalid prekey bundle: missing required fields');
	}

	if (!bundleData.signedPreKey) {
		throw new Error('Invalid prekey bundle: signed prekey is required');
	}

	const signedPreKey = bundleData.signedPreKey;
	if (
		typeof signedPreKey.id !== 'number' ||
		typeof signedPreKey.publicKey !== 'string' ||
		typeof signedPreKey.signature !== 'string'
	) {
		throw new TypeError('Invalid prekey bundle: malformed signed prekey');
	}

	// Build a DeviceType object expected by SessionBuilder.processPreKey
	const device: DeviceType = {
		identityKey: base64ToArrayBuffer(bundleData.identityKey),
		registrationId: bundleData.registrationId,
		signedPreKey: {
			keyId: signedPreKey.id,
			publicKey: base64ToArrayBuffer(signedPreKey.publicKey),
			signature: base64ToArrayBuffer(signedPreKey.signature)
		}
	};

	// Add one-time prekey if available (optional, provides forward secrecy)
	if (Array.isArray(bundleData.preKeys) && bundleData.preKeys.length > 0) {
		const preKey = bundleData.preKeys[0];
		if (typeof preKey.id === 'number' && typeof preKey.publicKey === 'string') {
			device.preKey = {
				keyId: preKey.id,
				publicKey: base64ToArrayBuffer(preKey.publicKey)
			};
		}
	}

	const address = new SignalProtocolAddress(userId, DEFAULT_DEVICE_ID);
	const sessionBuilder = new SessionBuilder(store.asStorageType(), address);

	logger.info('[SignalSession] Processing prekey to establish session...');
	try {
		await sessionBuilder.processPreKey(device);
		logger.info('[SignalSession] Session established successfully with:', userId);
	} catch (error) {
		logger.error('[SignalSession] Failed to establish session:', error);
		throw error;
	}
}

/**
 * Encrypt a plaintext message for a recipient using Signal Protocol
 *
 * @param store - IndexedDB store instance
 * @param recipientId - User ID of the recipient
 * @param plaintext - Plaintext message to encrypt
 * @returns Encrypted message with type and base64-encoded body
 */
export async function encryptMessage(
	store: IndexedDBSignalProtocolStore,
	recipientId: string,
	plaintext: string
): Promise<EncryptedMessage> {
	const address = new SignalProtocolAddress(recipientId, DEFAULT_DEVICE_ID);
	const sessionCipher = new SessionCipher(store.asStorageType(), address);

	const encoder = new TextEncoder();
	const messageBytes = encoder.encode(plaintext);

	const ciphertext = await sessionCipher.encrypt(messageBytes.buffer);

	logger.info('[SignalSession] Encryption result:', {
		type: ciphertext.type,
		bodyType: typeof ciphertext.body,
		bodyPresent: !!ciphertext.body
	});

	// Validate encryption result
	if (!ciphertext.body) {
		throw new Error('Signal encryption produced no ciphertext body');
	}

	// Convert body to base64 string for transmission
	let bodyBase64: string;
	const body: unknown = ciphertext.body;

	if (typeof body === 'string') {
		// Check if it's already base64 or binary string
		const isBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(body);

		if (isBase64 && body.length % 4 === 0) {
			logger.info('[SignalSession] Body is already base64');
			bodyBase64 = body;
		} else {
			logger.info('[SignalSession] Body is binary string, converting to base64');
			bodyBase64 = btoa(body);
		}
	} else if (body instanceof ArrayBuffer) {
		logger.info('[SignalSession] Body is ArrayBuffer, converting to base64');
		bodyBase64 = arrayBufferToBase64(body);
	} else {
		logger.error('[SignalSession] Unexpected body type:', typeof body);
		throw new Error('Unexpected ciphertext body type');
	}

	logger.debug('[SignalSession] Encrypted message', {
		length: bodyBase64.length,
		preview: bodyBase64.substring(0, 50)
	});

	return {
		type: ciphertext.type as EncryptionResultMessageType,
		body: bodyBase64
	};
}

/**
 * Decrypt a ciphertext message from a sender using Signal Protocol
 *
 * @param store - IndexedDB store instance
 * @param senderId - User ID of the sender
 * @param ciphertext - Encrypted message (object or string)
 * @returns Decrypted plaintext message
 */
export async function decryptMessage(
	store: IndexedDBSignalProtocolStore,
	senderId: string,
	ciphertext: EncryptedMessage | string
): Promise<string> {
	// Determine message type and decode body from base64
	let ctType: EncryptionResultMessageType;
	let ctBody: ArrayBuffer;

	if (typeof ciphertext === 'string') {
		// Legacy format: string is assumed to be PreKeyWhisperMessage
		ctType = EncryptionResultMessageType.PreKeyWhisperMessage;
		ctBody = base64ToArrayBuffer(ciphertext);
	} else {
		// Standard format: object with type and body
		ctType = ciphertext.type;
		ctBody = base64ToArrayBuffer(ciphertext.body);
	}

	logger.info('[SignalSession] Decrypting message:', {
		senderId,
		messageType: ctType,
		messageTypeName: ctType === 3 ? 'PreKeyWhisperMessage' : 'WhisperMessage',
		bodyLength: ctBody.byteLength
	});

	const address = new SignalProtocolAddress(senderId, DEFAULT_DEVICE_ID);
	const sessionCipher = new SessionCipher(store.asStorageType(), address);

	let plaintext: ArrayBuffer;

	try {
		// Type 3 (PreKeyWhisperMessage) establishes or uses session with prekey
		// Type 1 (WhisperMessage) uses existing session
		if (ctType === EncryptionResultMessageType.PreKeyWhisperMessage) {
			logger.info('[SignalSession] Decrypting PreKeyWhisperMessage - will establish/use session');
			plaintext = await sessionCipher.decryptPreKeyWhisperMessage(ctBody, 'binary');
		} else {
			logger.info('[SignalSession] Decrypting WhisperMessage - using existing session');
			plaintext = await sessionCipher.decryptWhisperMessage(ctBody, 'binary');
		}
		logger.info('[SignalSession] Decryption successful, plaintext length:', plaintext.byteLength);
	} catch (error) {
		logger.error('[SignalSession] Decryption error details:', {
			error,
			senderId,
			messageType: ctType,
			hasSession: !!(await store.loadSession(address.toString()))
		});
		throw error;
	}

	// Decode UTF-8 plaintext
	const decoder = new TextDecoder();
	return decoder.decode(plaintext);
}

/**
 * Check if we have an established session with a user
 *
 * @param store - IndexedDB store instance
 * @param targetUserId - User ID to check session with
 * @returns True if session exists
 */
export async function hasSession(
	store: IndexedDBSignalProtocolStore,
	targetUserId: string
): Promise<boolean> {
	const address = new SignalProtocolAddress(targetUserId, DEFAULT_DEVICE_ID);
	const session = await store.loadSession(address.toString());
	return !!session;
}

/**
 * Remove all sessions with a specific user
 *
 * @param store - IndexedDB store instance
 * @param targetUserId - User ID to remove sessions with
 */
export async function removeSessionWith(
	store: IndexedDBSignalProtocolStore,
	targetUserId: string
): Promise<void> {
	await store.removeAllSessions(targetUserId);
	logger.info(`[SignalSession] Removed all sessions with user ${targetUserId}`);
}
