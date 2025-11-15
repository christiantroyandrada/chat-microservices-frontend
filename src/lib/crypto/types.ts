/**
 * Crypto & Signal Protocol Types
 *
 * This file contains type definitions for Signal Protocol implementation,
 * encryption/decryption operations, and related data structures.
 */

// Used by: signal.ts - generateSignalIdentity()
export interface Identity {
	publicKey: string;
	privateKey: string;
}

// Used by: signal.ts, chat.service.ts, websocket.service.ts
// Encrypted message envelope sent over the wire
export interface EncryptedEnvelope {
	__encrypted: boolean;
	type: number; // Signal protocol message type (1=PreKey, 3=Whisper)
	body: string; // Base64-encoded ciphertext
}

// Used by: signal.ts - createSessionWithPrekeyBundle()
// Shape of prekey bundle received from server for session establishment
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

// Used by: signal.ts - createSessionWithPrekeyBundle()
// Wrapper for prekey bundle with metadata
export interface PrekeyBundlePayload {
	userId?: string;
	deviceId?: string;
	bundle?: PrekeyBundleData;
}

// Used by: messageStore.ts
// Local plaintext message storage (IndexedDB)
export interface LocalStoredMessage {
	_id: string;
	senderId: string;
	receiverId: string;
	content: string; // plaintext (decrypted)
	timestamp: string;
	read?: boolean;
}
