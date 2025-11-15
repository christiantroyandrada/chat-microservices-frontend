/**
 * Crypto & Signal Protocol Types
 *
 * This file contains type definitions for Signal Protocol implementation,
 * encryption/decryption operations, and related data structures.
 */

import type {
	EncryptionResultMessageType,
	KeyPairType
} from '@privacyresearch/libsignal-protocol-typescript';

// ============================================================================
// Core Identity & Authentication Types
// ============================================================================

/**
 * User identity with public/private key pair
 * Used by: signal.ts - generateSignalIdentity()
 */
export interface Identity {
	publicKey: string; // Base64-encoded public key
	privateKey: string; // Base64-encoded private key
}

/**
 * Identity object extended with the public bundle for publication
 * Used by: signal.ts - generateSignalIdentity()
 */
export interface GeneratedIdentity extends Identity {
	_signalBundle: PublicPreKeyBundle;
}

// ============================================================================
// Prekey Bundle Types (Key Exchange)
// ============================================================================

/**
 * Public prekey bundle for server publication
 * Contains only public keys - safe for network transmission
 * Used by: signal.ts - publishSignalPrekey()
 */
export interface PublicPreKeyBundle {
	identityKey: string; // Base64-encoded identity public key
	registrationId: number;
	signedPreKey: {
		id: number;
		publicKey: string; // Base64-encoded
		signature: string; // Base64-encoded (proves identity key ownership)
	};
	preKeys: Array<{
		id: number;
		publicKey: string; // Base64-encoded one-time prekey
	}>;
}

/**
 * Prekey bundle received from server for session establishment
 * Used by: signal.ts - createSessionWithPrekeyBundle()
 */
export interface PrekeyBundleData {
	identityKey: string;
	registrationId: number;
	signedPreKey?: {
		id: number;
		publicKey: string;
		signature: string;
	};
	preKeys?: Array<{
		id: number;
		publicKey: string;
	}>;
	userId?: string;
}

/**
 * Wrapper for prekey bundle with metadata
 * Used by: signal.ts - createSessionWithPrekeyBundle()
 */
export interface PrekeyBundlePayload {
	userId?: string;
	deviceId?: string;
	bundle?: PrekeyBundleData;
}

// ============================================================================
// Storage & Internal Types
// ============================================================================

/**
 * Extended SignedPreKey type with private key for storage
 * Includes signature field required by Signal Protocol
 * Used by: signal.ts - IndexedDB storage
 */
export interface StoredSignedPreKey {
	pubKey: ArrayBuffer;
	privKey: ArrayBuffer;
	signature: ArrayBuffer;
}

/**
 * Type-safe interface for the IndexedDB cache
 * Used by: signal.ts - IndexedDBSignalProtocolStore
 */
export interface SignalCache {
	identityKeyPair?: KeyPairType<ArrayBuffer>;
	registrationId?: number;
	[key: `identity_${string}`]: ArrayBuffer | undefined;
	[key: `prekey_${number}`]: KeyPairType<ArrayBuffer> | undefined;
	[key: `signed_prekey_${number}`]: StoredSignedPreKey | undefined;
	[key: `session_${string}`]: string | undefined;
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Encrypted message result from Signal Protocol encryption
 * Used by: signal.ts - encryptMessage(), decryptMessage()
 */
export interface EncryptedMessage {
	type: EncryptionResultMessageType;
	body: string; // Base64-encoded ciphertext
}

/**
 * Encrypted message envelope sent over the wire
 * Used by: signal.ts, chat.service.ts, websocket.service.ts
 */
export interface EncryptedEnvelope {
	__encrypted: boolean;
	type: number; // Signal protocol message type (1=WhisperMessage, 3=PreKeyWhisperMessage)
	body: string; // Base64-encoded ciphertext
}

/**
 * Local plaintext message storage (IndexedDB)
 * Used by: messageStore.ts
 */
export interface LocalStoredMessage {
	_id: string;
	senderId: string;
	receiverId: string;
	content: string; // plaintext (decrypted)
	timestamp: string;
	read?: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * API response shape for prekey publication
 * Used by: signal.ts - publishSignalPrekey()
 */
export interface PublishPrekeyResponse {
	success: boolean;
	message?: string;
	data?: unknown;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for StoredSignedPreKey
 * Validates that a value has the correct shape for a stored signed prekey
 * @param value - Value to check
 * @returns True if value is a valid StoredSignedPreKey
 */
export function isStoredSignedPreKey(value: unknown): value is StoredSignedPreKey {
	return (
		typeof value === 'object' &&
		value !== null &&
		'pubKey' in value &&
		'privKey' in value &&
		'signature' in value &&
		value.pubKey instanceof ArrayBuffer &&
		value.privKey instanceof ArrayBuffer &&
		value.signature instanceof ArrayBuffer
	);
}
