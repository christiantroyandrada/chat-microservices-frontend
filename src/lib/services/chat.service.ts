import { apiClient } from './api';
import { env } from '$env/dynamic/public';
import {
	initSignal,
	createSessionWithPrekeyBundle,
	encryptMessage,
	decryptMessage
} from '$lib/crypto/signal';
import type { Message, SendMessagePayload, ChatConversation, ServerMessage } from '$lib/types';

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
	 */
	async getConversations(): Promise<ChatConversation[]> {
		const response = await apiClient.get<ChatConversation[]>('/chat/conversations');
		return response.data || [];
	},

	/**
	 * Get messages between current user and another user
	 */
	async getMessages(userId: string, limit = 50, offset = 0): Promise<Message[]> {
		// backend exposes GET /get/:receiverId on the chat router (mounted under /chat)
		const response = await apiClient.get<ServerMessage[]>(
			`/chat/get/${userId}?limit=${limit}&offset=${offset}`
		);
		const data = response.data || [];
		const normalized = data.map(normalizeMessage);

		// Decrypt any encrypted messages in the history
		await initSignal();

		const decrypted = await Promise.all(
			normalized.map(async (msg) => {
				try {
					// Check if content is an encrypted envelope
					type EncryptedEnvelope = { __encrypted: boolean; type: number; body: string };
					let parsed: EncryptedEnvelope | null = null;
					try {
						parsed = JSON.parse(msg.content) as EncryptedEnvelope;
					} catch {
						return msg; // not JSON, return as-is
					}

					if (!parsed || !parsed.__encrypted) {
						return msg; // not encrypted, return as-is
					}

					// Additional check: if body doesn't look like base64, skip it (might be corrupted or already decrypted)
					if (!/^[A-Za-z0-9+/]+=*$/.test(parsed.body)) {
						console.warn('[ChatService] Message body is not valid base64, skipping decryption');
						return msg;
					}

					console.log(
						'[ChatService] Decrypting message from history, senderId:',
						msg.senderId,
						'type:',
						parsed.type
					);

					// Decrypt the message
					const ctObj = { type: parsed.type, body: parsed.body };
					const plaintext = await decryptMessage(msg.senderId, ctObj);

					console.log('[ChatService] Successfully decrypted message:', plaintext);

					return {
						...msg,
						content: plaintext
					};
				} catch (decryptError) {
					console.error('[ChatService] Failed to decrypt message from history:', decryptError);
					// Return original message if decryption fails - better to show encrypted than nothing
					return msg;
				}
			})
		);

		return decrypted;
	},

	/**
	 * Send a message to another user
	 */
	async sendMessage(payload: SendMessagePayload): Promise<Message> {
		// Validate payload before sending
		if (!payload.receiverId || !payload.content) {
			throw new Error('Invalid message payload');
		}

		if (payload.content.length > 5000) {
			throw new Error('Message too long');
		}

		// Require end-to-end encryption: initialize Signal and encrypt before sending.
		const apiBase = env.PUBLIC_API_URL || 'http://localhost:85';
		await initSignal();

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
		// Pass the complete data object with userId, deviceId, and bundle
		await createSessionWithPrekeyBundle(prekeyBundleData);

		// encryptMessage returns {type: number, body: string} where body is already base64-encoded
		const ct = await encryptMessage(String(payload.receiverId), payload.content);

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
