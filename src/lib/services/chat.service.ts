import { chatApi, userApi, type HistoryCursor } from './api.generated';
import { mergeDelivery, mergeMessages } from './message-merge';
import { assertValidServerMessage, normalizeMessage } from './server-message';
import {
	initSignal,
	hasSession as signalHasSession,
	createSessionWithPrekeyBundle,
	encryptMessage,
	decryptMessage,
	SignalDecryptionError
} from '$lib/crypto/signal';
import { getMessageStore } from '$lib/crypto/messageStore';
import type {
	Message,
	SendMessagePayload,
	ChatConversation,
	ServerMessage,
	User
} from '$lib/types';
import type { EncryptedEnvelope } from '$lib/crypto/types';
import type { ChatApiConversation, UserApiSearchUser } from '$lib/generated/api.types';
import {
	ContractBoundaryError,
	assertNonEmptyString,
	assertString,
	assertStringOrNull,
	assertFiniteNumber,
	assertArray,
	assertObject
} from './contract-boundary';

/**
 * ServiceResult is imported from central types file.
 */

let activeOwner: string | null = null;
let ownerGeneration = 0;
const sending = new Map<string, Promise<Message>>();
const clearingNotifications = new Map<string, Promise<void>>();
type ProcessedMessage = { message: Message; uncached: boolean };
type HistoryPage = {
	messages: Message[];
	firstId?: string;
	lastId?: string;
	hasMore: boolean;
	cached?: boolean;
};
const receiving = new Map<string, Promise<ProcessedMessage>>();
const receivedEvents = new Set<string>();

function assertOwner(owner: string, generation: number) {
	if (activeOwner !== owner || ownerGeneration !== generation)
		throw new Error('Account changed. Message remains on this device.');
}

async function updateReceipt(owner: string, request: () => Promise<unknown>): Promise<void> {
	const generation = ownerGeneration;
	assertOwner(owner, generation);
	try {
		await request();
	} catch (error) {
		if (authenticationFailure(error)) await requireReauthentication(owner);
		throw error;
	}
	assertOwner(owner, generation);
}

function authenticationFailure(error: unknown): boolean {
	return [401, 403].includes((error as { status?: number })?.status ?? 0);
}

function unavailable(error: unknown): boolean {
	const status = (error as { status?: number })?.status;
	return !(error instanceof ContractBoundaryError) && (!status || status >= 500);
}

async function requireReauthentication(owner: string): Promise<void> {
	if (activeOwner === owner) {
		activeOwner = null;
		ownerGeneration++;
		receivedEvents.clear();
	}
	const store = getMessageStore(owner);
	for (const message of await store.getUnfinishedMessages()) {
		if (
			message.senderId === owner &&
			message.sendState !== 'accepted' &&
			message.retryable !== false
		) {
			await store.failMessage({
				...message,
				sendState: 'failed',
				retryable: false,
				sendError: 'reauthentication_required'
			});
		}
	}
}

async function processMessage(
	message: Message,
	owner: string,
	generation: number,
	retry = false
): Promise<ProcessedMessage> {
	const key = generation + ':' + message._id;
	const inFlight = receiving.get(key);
	if (inFlight !== undefined) return inFlight;
	const operation = (async () => {
		assertOwner(owner, generation);
		const store = getMessageStore(owner);
		const existing = await store.getMessage(message._id);
		assertOwner(owner, generation);
		if (retry && existing?.decryptionRecovery !== 'retry') {
			if (!existing) throw new Error('Message is no longer available.');
			return { message: existing, uncached: false };
		}
		const ciphertext = existing?._encryptedContent ?? message.content;
		let envelope: EncryptedEnvelope | undefined;
		try {
			envelope = JSON.parse(ciphertext);
		} catch {
			/* Legacy plaintext. */
		}
		if (
			existing &&
			((!existing._decryptionFailed && !existing.content.startsWith('🔒')) ||
				(envelope?.type === 3 && !retry))
		) {
			const merged = mergeDelivery(existing, message);
			if (merged.status !== existing.status || merged.read !== existing.read)
				await store.saveMessage(merged);
			return { message: merged, uncached: false };
		}
		if (message.senderId === owner && message.clientMessageId) {
			const pending = await store.getMessage(message.clientMessageId);
			assertOwner(owner, generation);
			if (
				pending?.senderId === owner &&
				pending.receiverId === message.receiverId &&
				pending.encryptedMessage === message.content
			) {
				const accepted: Message = {
					...pending,
					...message,
					content: pending.content,
					sendState: 'accepted',
					retryable: false,
					sendError: undefined,
					pendingNotification: false
				};
				await store.settleMessage(pending._id, accepted);
				void clearLegacyNotification(accepted, owner, generation).catch(() => {});
				return { message: accepted, uncached: false };
			}
		}
		let result = message;
		if (envelope?.__encrypted && /^[A-Za-z0-9+/]+=*$/.test(envelope.body)) {
			if (message.senderId === owner)
				result = { ...message, content: '🔒 [Your encrypted message]' };
			else {
				try {
					await initSignal(owner);
					assertOwner(owner, generation);
					const content = await decryptMessage(
						message.senderId,
						{ type: envelope.type, body: envelope.body },
						owner
					);
					result = {
						...message,
						content,
						_decryptionFailed: false,
						_encryptedContent: undefined,
						decryptionRecovery: undefined
					};
				} catch (error) {
					assertOwner(owner, generation);
					const details = error instanceof SignalDecryptionError ? error : undefined;
					const keysMissing =
						details?.hasIdentityKey === false || details?.hasSignedPreKey === false;
					const resend = !keysMissing && (envelope.type === 3 || details?.hasSession === false);
					result = {
						...message,
						content: resend
							? '🔒 Ask the sender to resend this message.'
							: '🔒 Message could not be decrypted.',
						_decryptionFailed: true,
						_encryptedContent: ciphertext,
						decryptionRecovery: resend ? 'resend' : 'retry'
					};
				}
			}
		}
		assertOwner(owner, generation);
		await store.saveMessage(result);
		return { message: result, uncached: !existing };
	})();
	receiving.set(key, operation);
	try {
		return await operation;
	} finally {
		receiving.delete(key);
	}
}

async function clearLegacyNotification(
	message: Message,
	owner: string,
	generation: number
): Promise<void> {
	const key = owner + ':' + message._id;
	const existing = clearingNotifications.get(key);
	if (existing !== undefined) return existing;
	const operation = (async () => {
		if (!message.pendingNotification) return;
		const store = getMessageStore(owner);
		assertOwner(owner, generation);
		assertOwner(owner, generation);
		const latest = await store.getMessage(message._id);
		assertOwner(owner, generation);
		if (latest) await store.saveMessage({ ...latest, pendingNotification: false });
	})();
	clearingNotifications.set(key, operation);
	try {
		await operation;
	} finally {
		clearingNotifications.delete(key);
	}
}

export const chatService = {
	activateOwner(owner: string | null) {
		activeOwner = owner;
		ownerGeneration++;
		receivedEvents.clear();
	},
	async verifyOwner(owner: string): Promise<void> {
		const generation = ownerGeneration;
		assertOwner(owner, generation);
		const store = getMessageStore(owner);
		const rows = await store.getUnfinishedMessages();
		assertOwner(owner, generation);
		for (const message of rows) {
			if (message.senderId === owner && message.sendError === 'reauthentication_required') {
				await store.saveMessage({
					...message,
					retryable: true,
					sendError: 'Message not confirmed. You can retry.'
				});
				assertOwner(owner, generation);
			}
		}
	},
	/**
	 * Get all conversations for the current user
	 * Pulls last message preview from local storage (already decrypted)
	 */
	async getConversations(currentUserId = activeOwner ?? undefined): Promise<ChatConversation[]> {
		if (!currentUserId) throw new Error('Current account is required');
		const generation = ownerGeneration;
		const pending = currentUserId
			? await getMessageStore(currentUserId).getUnfinishedMessages()
			: [];
		if (currentUserId) assertOwner(currentUserId, generation);
		let response;
		try {
			response = await chatApi.getConversations(currentUserId);
		} catch (error) {
			if (currentUserId && authenticationFailure(error))
				await requireReauthentication(currentUserId);
			if (!unavailable(error) || !pending.some((message) => message.senderId === currentUserId))
				throw error;
			response = { data: [] };
		}
		if (currentUserId) assertOwner(currentUserId, generation);
		const data = assertArray(response.data, 'chat.getConversations', 'data');
		for (const conv of data) {
			const c = assertObject(conv, 'chat.getConversations', 'conversation');
			assertNonEmptyString((c as Record<string, unknown>).id, 'chat.getConversations', 'id');
			assertNonEmptyString((c as Record<string, unknown>).name, 'chat.getConversations', 'name');
			assertStringOrNull((c as Record<string, unknown>).avatar, 'chat.getConversations', 'avatar');
			assertString(
				(c as Record<string, unknown>).lastMessage,
				'chat.getConversations',
				'lastMessage'
			);
			assertFiniteNumber(
				(c as Record<string, unknown>).unreadCount,
				'chat.getConversations',
				'unreadCount'
			);
			assertString(
				(c as Record<string, unknown>).lastMessageTime,
				'chat.getConversations',
				'lastMessageTime'
			);
		}
		const conversations: ChatConversation[] = (data as ChatApiConversation[]).map(
			(conversation) => ({
				userId: conversation.id,
				username: conversation.name,
				lastMessage: conversation.lastMessage,
				lastMessageTime: conversation.lastMessageTime,
				unreadCount: conversation.unreadCount
			})
		);

		// If we have currentUserId, try to get last message from local storage
		if (currentUserId) {
			const messageStore = getMessageStore(currentUserId);
			for (const message of pending) {
				if (
					message.senderId === currentUserId &&
					!conversations.some((c) => c.userId === message.receiverId)
				) {
					conversations.push({
						userId: message.receiverId,
						username: message.recipientUsername || 'User',
						unreadCount: 0
					});
				}
			}

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
		return (await chatService.getMessagesPage(userId, limit, offset, currentUserId)).messages;
	},

	async getMessagesPage(
		userId: string,
		limit: number,
		offset: number,
		currentUserId?: string,
		cursor?: HistoryCursor
	): Promise<HistoryPage> {
		if (!currentUserId) throw new Error('currentUserId is required for getMessages');
		const generation = ownerGeneration;
		assertOwner(currentUserId, generation);
		const store = getMessageStore(currentUserId);
		const local = cursor ? [] : await store.getMessages(userId, currentUserId, limit);
		assertOwner(currentUserId, generation);
		let response;
		try {
			response = cursor
				? await chatApi.getMessages(userId, limit, offset, currentUserId, cursor)
				: await chatApi.getMessages(userId, limit, offset, currentUserId);
		} catch (error) {
			if (authenticationFailure(error)) {
				await requireReauthentication(currentUserId);
				throw error;
			}
			assertOwner(currentUserId, generation);
			if (unavailable(error) && local.length)
				return { messages: local, hasMore: false, cached: true };
			throw error;
		}
		assertOwner(currentUserId, generation);
		const data = assertArray(response.data, 'chat.getMessages', 'data');
		const processed: Message[] = [];
		for (const raw of data) {
			assertValidServerMessage(raw, 'chat.getMessages');
			if (!(
				(raw.senderId === currentUserId && raw.receiverId === userId) ||
				(raw.senderId === userId && raw.receiverId === currentUserId)
			))
				throw new ContractBoundaryError(
					'chat.getMessages: message does not match the requested conversation'
				);
		}
		for (const raw of data as ServerMessage[])
			processed.push(
				(await processMessage(normalizeMessage(raw), currentUserId, generation)).message
			);
		const latest = cursor ? [] : await store.getMessages(userId, currentUserId, limit);
		assertOwner(currentUserId, generation);
		return {
			messages: cursor ? processed : mergeMessages(processed, latest),
			firstId: processed[0]?._id,
			lastId: processed.at(-1)?._id,
			hasMore: response.pagination?.hasMore === true
		};
	},

	async receiveMessage(
		message: Message,
		owner: string
	): Promise<{ message: Message; fresh: boolean }> {
		const generation = ownerGeneration;
		if (
			!message._id ||
			!message.senderId ||
			!message.receiverId ||
			(message.receiverId !== owner && message.senderId !== owner)
		)
			throw new Error('Invalid incoming message');
		const processed = await processMessage(message, owner, generation);
		assertOwner(owner, generation);
		const key = owner + ':' + message._id;
		const fresh = processed.uncached && !receivedEvents.has(key);
		receivedEvents.add(key);
		return { message: processed.message, fresh };
	},

	async retryDecryption(messageId: string, owner: string): Promise<Message> {
		const generation = ownerGeneration;
		assertOwner(owner, generation);
		const cached = await getMessageStore(owner).getMessage(messageId);
		assertOwner(owner, generation);
		if (
			cached?.receiverId !== owner ||
			cached.senderId === owner ||
			cached.decryptionRecovery !== 'retry' ||
			!cached._encryptedContent
		)
			throw new Error('This message cannot be retried.');
		const { message } = await processMessage(cached, owner, generation, true);
		assertOwner(owner, generation);
		return message;
	},

	async prepareMessage(
		payload: SendMessagePayload,
		owner: string,
		recipientUsername?: string
	): Promise<Message> {
		const generation = ownerGeneration;
		assertOwner(owner, generation);
		if (!payload.receiverId || !payload.content || payload.content.length > 5000)
			throw new Error('Invalid message payload');
		await initSignal(owner);
		assertOwner(owner, generation);
		const sessionExists = await signalHasSession(payload.receiverId, owner);
		assertOwner(owner, generation);
		if (!sessionExists) {
			const response = await userApi.getPrekeyBundle(payload.receiverId);
			assertOwner(owner, generation);
			if (!response.data)
				throw new Error(
					'Recipient does not have an available prekey bundle; cannot send encrypted message'
				);
			await createSessionWithPrekeyBundle(response.data, owner);
			assertOwner(owner, generation);
		}
		const cipher = await encryptMessage(payload.receiverId, payload.content, owner);
		assertOwner(owner, generation);
		const encryptedMessage = JSON.stringify({
			__encrypted: true,
			type: cipher.type,
			body: cipher.body
		});
		if (encryptedMessage.length > 5000)
			throw new Error('Encrypted message too long. Please shorten the message.');
		const clientMessageId = crypto.randomUUID();
		const message: Message = {
			_id: clientMessageId,
			clientMessageId,
			senderId: owner,
			receiverId: payload.receiverId,
			content: payload.content,
			timestamp: new Date().toISOString(),
			encryptedMessage,
			sendState: 'pending',
			retryable: true,
			recipientUsername
		};
		const store = getMessageStore(owner);
		await store.saveMessage(message);
		assertOwner(owner, generation);
		return message;
	},

	retryMessage(clientMessageId: string, owner: string): Promise<Message> {
		const generation = ownerGeneration;
		const key = owner + ':' + clientMessageId;
		const existing = sending.get(key);
		if (existing !== undefined) return existing;
		const operation = (async () => {
			assertOwner(owner, generation);
			const store = getMessageStore(owner);
			const pending = await store.getSendCommand(clientMessageId);
			assertOwner(owner, generation);
			if (
				!pending ||
				pending.senderId !== owner ||
				!pending.clientMessageId ||
				!pending.encryptedMessage
			)
				throw new Error('Stored send command is missing');
			if (pending.sendState === 'accepted') {
				try {
					await clearLegacyNotification(pending, owner, generation);
				} catch {
					/* Retry on the next connection. */
				}
				return pending;
			}
			if (pending.retryable === false) return pending;
			let accepted: Message;
			try {
				assertOwner(owner, generation);
				const command = {
					expectedSenderId: owner,
					receiverId: pending.receiverId,
					clientMessageId: pending.clientMessageId,
					message: pending.encryptedMessage
				};
				const response = await chatApi.sendMessage(command);
				assertValidServerMessage(response.data, 'chat.sendMessage');
				const raw = response.data;
				if (
					raw.senderId !== owner ||
					raw.receiverId !== pending.receiverId ||
					raw.clientMessageId !== pending.clientMessageId ||
					raw.message !== pending.encryptedMessage
				)
					throw new Error('Server response does not match the stored send command');
				accepted = {
					...pending,
					...normalizeMessage(raw),
					content: pending.content,
					sendState: 'accepted',
					retryable: false,
					sendError: undefined,
					pendingNotification: false
				};
				const cached = await store.getMessage(accepted._id);
				if (cached)
					accepted = {
						...mergeDelivery(accepted, cached),
						pendingNotification: false
					};
				await store.settleMessage(pending._id, accepted);
			} catch (error) {
				const conflict = (error as { status?: number })?.status === 409;
				const unauthorized = authenticationFailure(error);
				if (unauthorized) await requireReauthentication(owner);
				const failed: Message = {
					...pending,
					sendState: 'failed',
					retryable: !conflict && !unauthorized,
					sendError: unauthorized
						? 'reauthentication_required'
						: conflict
							? 'This message conflicts with an existing send command.'
							: 'Message not confirmed. Retry uses the same encrypted message.'
				};
				await store.failMessage(failed);
				const latest = await store.getSendCommand(pending.clientMessageId);
				if (latest?.sendState === 'accepted') {
					try {
						await clearLegacyNotification(latest, owner, generation);
					} catch {
						/* REST acceptance remains durable. */
					}
				}
				return latest ?? failed;
			}
			try {
				await clearLegacyNotification(accepted, owner, generation);
			} catch {
				/* REST acceptance remains durable. */
			}
			return accepted;
		})();
		sending.set(key, operation);
		void operation.finally(() => sending.delete(key)).catch(() => {});
		return operation;
	},

	async sendMessage(payload: SendMessagePayload, owner?: string): Promise<Message> {
		if (!owner) throw new Error('currentUserId is required');
		const pending = await this.prepareMessage(payload, owner);
		return this.retryMessage(pending._id, owner);
	},

	async flushNotifications(owner: string): Promise<void> {
		const generation = ownerGeneration;
		assertOwner(owner, generation);
		const rows = await getMessageStore(owner).getUnfinishedMessages();
		for (const message of rows) {
			assertOwner(owner, generation);
			if (
				message.senderId === owner &&
				message.sendState === 'accepted' &&
				message.pendingNotification
			) {
				try {
					await clearLegacyNotification(message, owner, generation);
				} catch {
					/* Retry on the next connection. */
				}
			}
		}
	},

	async acknowledgeDelivery(messageId: string, owner: string): Promise<void> {
		await updateReceipt(owner, () => chatApi.acknowledgeDelivery(messageId, owner));
	},

	async markAsRead(
		senderId: string,
		owner = activeOwner,
		messageIds?: readonly string[]
	): Promise<void> {
		if (!owner) throw new Error('Current account is required');
		await updateReceipt(owner, () =>
			messageIds
				? chatApi.markAsRead(senderId, owner, messageIds)
				: chatApi.markAsRead(senderId, owner)
		);
	},

	/**
	 * Search users for starting new conversations
	 */
	async searchUsers(query: string): Promise<User[]> {
		const response = await userApi.searchUsers(query);
		const data = assertArray(response.data, 'chat.searchUsers', 'data');
		for (const u of data) {
			const obj = assertObject(u, 'chat.searchUsers', 'user');
			assertNonEmptyString((obj as Record<string, unknown>)._id, 'chat.searchUsers', '_id');
			assertNonEmptyString(
				(obj as Record<string, unknown>).username,
				'chat.searchUsers',
				'username'
			);
			assertNonEmptyString((obj as Record<string, unknown>).email, 'chat.searchUsers', 'email');
		}
		return (data as UserApiSearchUser[]).map((u) => ({
			_id: u._id,
			username: u.username,
			email: u.email
		})) as User[];
	}
};
