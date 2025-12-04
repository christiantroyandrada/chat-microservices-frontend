import { apiClient } from './api';
import { env } from '$env/dynamic/public';
import {
	initSignal,
	createSessionWithPrekeyBundle,
	encryptMessage,
	decryptMessage,
	SignalDecryptionError
} from '$lib/crypto/signal';
import { getMessageStore } from '$lib/crypto/messageStore';
import type { Message, SendMessagePayload, ChatConversation, ServerMessage } from '$lib/types';
import type { EncryptedEnvelope } from '$lib/crypto/types';
import { logger } from './dev-logger';

/**
 * ServiceResult is imported from central types file.
 */

/**
 * Helper to normalize server message shape -> frontend Message
 * Backend uses `message` field, frontend uses `content` field
 */
function normalizeMessage(serverMsg: ServerMessage): Message {
	return {
		_id: serverMsg._id || serverMsg.id || String(serverMsg._id || serverMsg.id || ''),
		senderId: serverMsg.senderId,
		senderUsername: serverMsg.senderUsername || serverMsg.senderName || undefined,
		receiverId: serverMsg.receiverId,
		// backend uses `message`; frontend uses `content`
		content: serverMsg.message ?? serverMsg.content ?? '',
		// prefer an explicit timestamp, fall back to createdAt
		timestamp: serverMsg.timestamp ?? serverMsg.createdAt ?? new Date().toISOString(),
		read: serverMsg.read ?? serverMsg.isRead ?? false,
		createdAt: serverMsg.createdAt,
		updatedAt: serverMsg.updatedAt
	} as Message;
}

export const chatService = {
	/**
	 * Get all conversations for the current user
	 * Pulls last message preview from local storage (already decrypted)
	 */
	async getConversations(currentUserId?: string): Promise<ChatConversation[]> {
		const response = await apiClient.get<ChatConversation[]>('/chat/conversations');
		const conversations = response.data || [];

		// If we have currentUserId, try to get last message from local storage
		if (currentUserId) {
			const messageStore = getMessageStore(currentUserId);

			const conversationsWithLocalMessages = await Promise.all(
				conversations.map(async (conv) => {
					// Get the last message from local storage for this conversation
					const messages = await messageStore.getMessages(conv.userId, currentUserId, 1);

					if (messages.length > 0) {
						const lastLocalMessage = messages.at(-1)!;
						// Use local storage message (already decrypted plaintext)
						return {
							...conv,
							lastMessage:
								lastLocalMessage.senderId === currentUserId
									? `You: ${lastLocalMessage.content}`
									: lastLocalMessage.content,
							lastMessageTime: lastLocalMessage.timestamp
						};
					}

					// No local messages, return as-is (might be new conversation)
					return conv;
				})
			);

			return conversationsWithLocalMessages;
		}

		return conversations;
	},

	/**
	 * Get messages between current user and another user
	 * Uses local IndexedDB cache (Signal-style approach):
	 * 1. Try to load from local storage first (instant, plaintext)
	 * 2. If not in cache, fetch from server, decrypt, and store locally
	 */
	async getMessages(
		userId: string,
		limit = 50,
		offset = 0,
		currentUserId?: string
	): Promise<Message[]> {
		if (!currentUserId) {
			throw new Error('currentUserId is required for getMessages');
		}

		const messageStore = getMessageStore(currentUserId);

		// Fetch from server to get latest messages (including any missed real-time broadcasts)
		logger.info('[ChatService] Fetching messages from server...');
		const response = await apiClient.get<ServerMessage[]>(
			`/chat/get/${userId}?limit=${limit}&offset=${offset}`
		);
		const data = response.data || [];

		if (data.length === 0) {
			// No messages on server, check if we have anything locally
			const localMessages = await messageStore.getMessages(userId, currentUserId, limit);
			logger.info(
				`[ChatService] Server has no messages, loaded ${localMessages.length} from local storage`
			);
			return localMessages;
		}

		const normalized = data.map(normalizeMessage);

		// Decrypt and store messages locally
		await initSignal(currentUserId);

		const decrypted = await Promise.all(
			normalized.map(async (msg) => {
				// Check if already in local storage
				const existing = await messageStore.getMessage(msg._id);
				if (existing) {
					// If the cached message is a decryption error, try to decrypt again
					// This allows recovery when keys are restored after a failed attempt
					const existingWithMeta = existing as Message & {
						_decryptionFailed?: boolean;
						_encryptedContent?: string;
					};
					const isDecryptionError =
						existing.content.startsWith('🔒') || existingWithMeta._decryptionFailed === true;

					if (!isDecryptionError) {
						return existing; // Already have successfully decrypted version
					}

					logger.info(
						'[ChatService] Found cached decryption error, attempting to decrypt again:',
						msg._id
					);

					// Use preserved encrypted content if available, otherwise use server response
					if (existingWithMeta._encryptedContent) {
						msg = { ...msg, content: existingWithMeta._encryptedContent };
					}
					// Fall through to try decryption again with current keys
				}

				try {
					// Check if content is an encrypted envelope
					let parsed: EncryptedEnvelope | null = null;
					try {
						parsed = JSON.parse(msg.content) as EncryptedEnvelope;
					} catch {
						// Not JSON, store as-is
						await messageStore.saveMessage(msg);
						return msg;
					}

					if (!parsed?.__encrypted) {
						// Not encrypted, store as-is
						await messageStore.saveMessage(msg);
						return msg;
					}

					// Additional check: if body doesn't look like base64, skip it
					if (!/^[A-Za-z0-9+/]+=*$/.test(parsed.body)) {
						logger.warning('[ChatService] Message body is not valid base64, skipping decryption');
						await messageStore.saveMessage(msg);
						return msg;
					}

					// Check if this is a message sent BY the current user
					if (msg.senderId === currentUserId) {
						// Cannot decrypt our own sent messages (encrypted with recipient's key)
						// This shouldn't happen if we're caching sent messages properly
						logger.warning('[ChatService] Found own sent message from server - cannot decrypt');
						const placeholderMsg = {
							...msg,
							content: '🔒 [Your encrypted message]'
						};
						await messageStore.saveMessage(placeholderMsg);
						return placeholderMsg;
					}

					logger.info('[ChatService] Decrypting message from sender:', {
						sender_id: msg.senderId,
						type: String(parsed.type)
					});

					// Decrypt the message using the sender's ID
					const ctObj = { type: parsed.type, body: parsed.body };
					const plaintext = await decryptMessage(msg.senderId, ctObj, currentUserId);

					logger.info('[ChatService] Successfully decrypted, storing in local DB');

					// Store decrypted message locally (plaintext)
					const decryptedMsg = {
						...msg,
						content: plaintext
					};
					await messageStore.saveMessage(decryptedMsg);

					return decryptedMsg;
				} catch (decryptError) {
					// Provide detailed error information for Signal-specific errors
					let errorContent: string;
					if (decryptError instanceof SignalDecryptionError) {
						logger.error('[ChatService] Signal decryption error:', {
							message: decryptError.message,
							hasIdentityKey: String(decryptError.hasIdentityKey),
							hasSignedPreKey: String(decryptError.hasSignedPreKey),
							hasSession: String(decryptError.hasSession),
							messageId: msg._id
						});
						errorContent = `🔒 ${decryptError.message}`;
					} else {
						logger.error('[ChatService] Failed to decrypt message:', decryptError);
						logger.error('[ChatService] Message details:', {
							messageId: msg._id,
							senderId: msg.senderId,
							timestamp: msg.timestamp
						});
						errorContent = '🔒 [Message could not be decrypted - encryption keys may be missing]';
					}

					// Store with error message AND mark for retry
					// Keep original encrypted content so we can retry decryption later
					const errorMsg = {
						...msg,
						content: errorContent,
						_decryptionFailed: true,
						_encryptedContent: msg.content // Preserve original for retry
					} as Message & { _decryptionFailed: boolean; _encryptedContent: string };
					await messageStore.saveMessage(errorMsg);
					return errorMsg;
				}
			})
		);

		return decrypted;
	},

	/**
	 * Send a message to another user
	 */
	async sendMessage(payload: SendMessagePayload, currentUserId?: string): Promise<Message> {
		// Validate payload before sending
		if (!payload.receiverId || !payload.content) {
			throw new Error('Invalid message payload');
		}

		if (payload.content.length > 5000) {
			throw new Error('Message too long');
		}

		// Require end-to-end encryption: initialize Signal and encrypt before sending.
		const apiBase = env.PUBLIC_API_URL || 'http://localhost:80';
		await initSignal(currentUserId);

		// Fetch recipient prekey bundle (must be present for E2EE)
		// Backend returns: { status: 200, data: { userId, deviceId, bundle } }
		let prekeyBundleData: { userId: string; deviceId: string; bundle: unknown } | null = null;
		try {
			const resp = await fetch(
				`${apiBase}/api/user/prekeys/${encodeURIComponent(payload.receiverId)}`,
				{ credentials: 'include' }
			);
			if (resp.ok) {
				const json = await resp.json();
				// Extract the nested data object containing userId, deviceId, and bundle
				prekeyBundleData = json?.data || json;
			}
		} catch {
			// treat as missing prekey
			prekeyBundleData = null;
		}

		if (!prekeyBundleData) {
			throw new Error(
				'Recipient does not have an available prekey bundle; cannot send encrypted message'
			);
		}

		// Bootstrap session and encrypt (will throw on failure)
		// Pass the complete data object with userId, deviceId, and bundle, plus current user ID
		await createSessionWithPrekeyBundle(prekeyBundleData, currentUserId);

		// encryptMessage returns {type: number, body: string} where body is already base64-encoded
		const ct = await encryptMessage(String(payload.receiverId), payload.content, currentUserId);

		// Create encrypted envelope - body is already base64, no conversion needed
		type EncryptedEnvelope = { __encrypted: true; type: number; body: string };
		const payloadCipher: EncryptedEnvelope = {
			__encrypted: true,
			type: ct.type,
			body: ct.body // Already base64 from encryptMessage
		};

		const sendBody = { receiverId: payload.receiverId, message: JSON.stringify(payloadCipher) };

		// backend exposes POST /send on the chat router
		// backend expects `message` field, not `content`
		const response = await apiClient.post<ServerMessage>('/chat/send', sendBody);

		if (!response.data) {
			throw new Error('Failed to send message');
		}

		// Normalize the response and return with the original plaintext content
		// The server returns the encrypted message, but the sender should see their own plaintext
		const normalizedResponse = normalizeMessage(response.data);
		normalizedResponse.content = payload.content; // Use original plaintext for sender's view

		// Store the plaintext message in local IndexedDB (Signal-style approach)
		// This allows us to see our own sent messages after page reload
		if (currentUserId) {
			const messageStore = getMessageStore(currentUserId);
			await messageStore.saveMessage(normalizedResponse);
			logger.info('[ChatService] Saved sent message to local storage');
		}

		return normalizedResponse;
	},

	/**
	 * Mark messages as read
	 */
	async markAsRead(senderId: string): Promise<void> {
		await apiClient.put(`/chat/messages/read/${senderId}`);
	},

	/**
	 * Delete a message
	 */
	async deleteMessage(messageId: string): Promise<void> {
		await apiClient.delete(`/chat/messages/${messageId}`);
	},

	/**
	 * Search users for starting new conversations
	 */
	async searchUsers(query: string): Promise<ChatConversation[]> {
		const response = await apiClient.get<ChatConversation[]>(
			`/user/search?q=${encodeURIComponent(query)}`
		);
		return response.data || [];
	}
};
