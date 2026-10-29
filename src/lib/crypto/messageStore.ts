/**
 * Local Message Store - IndexedDB
 *
 * Inspired by Signal's approach:
 * - Messages are E2EE during transmission
 * - After decryption, messages are stored in plaintext in local IndexedDB
 * - The IndexedDB is specific to each browser/device
 * - Each user has their own isolated database
 *
 * This provides:
 * - Fast message retrieval (no decryption needed on load)
 * - Per-device message history
 * - Seamless UX like Signal Desktop
 */

import type { Message } from '$lib/types';
import { logger } from '$lib/services/dev-logger';
import { toError } from './signalUtils';

function transactionComplete(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Message transaction aborted'));
	});
}

async function writeMessages(
	db: IDBDatabase,
	enqueue: (store: IDBObjectStore) => void
): Promise<void> {
	const tx = db.transaction('messages', 'readwrite');
	const complete = transactionComplete(tx);
	try {
		enqueue(tx.objectStore('messages'));
	} catch (error) {
		void complete.catch(() => {});
		try {
			tx.abort();
		} catch {
			/* The transaction can already be inactive. */
		}
		throw error;
	}
	return complete;
}

class LocalMessageStore {
	private readonly dbName: string;
	private readonly version = 1;
	private db: IDBDatabase | null = null;

	constructor(private readonly userId: string) {
		// Each user gets their own database
		this.dbName = `chat-messages-${userId}`;
	}

	async init(): Promise<void> {
		if (this.db) return;

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, this.version);

			request.onerror = () => reject(toError(request.error));
			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Messages store: indexed by message ID
				if (!db.objectStoreNames.contains('messages')) {
					const messagesStore = db.createObjectStore('messages', { keyPath: '_id' });
					// Index by conversation (senderId + receiverId pair)
					messagesStore.createIndex('conversation', ['senderId', 'receiverId'], { unique: false });
					// Index by timestamp for sorting
					messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
				}

				// Conversations store: tracks last message per user
				if (!db.objectStoreNames.contains('conversations')) {
					db.createObjectStore('conversations', { keyPath: 'userId' });
				}
			};
		});
	}

	/**
	 * Save a message (sent or received) to local storage
	 * Messages are stored in plaintext after E2EE decryption
	 */
	async saveMessage(message: Message): Promise<void> {
		await this.init();
		if (!this.db) throw new Error('DB not initialized');

		return writeMessages(this.db, (store) => {
			store.put(message);
		});
	}

	/**
	 * Save multiple messages in a batch
	 */
	async saveMessages(messages: Message[]): Promise<void> {
		if (!messages.length) return;
		await this.init();
		if (!this.db) throw new Error('DB not initialized');

		return writeMessages(this.db, (store) => {
			for (const message of messages) store.put(message);
		});
	}

	async settleMessage(clientMessageId: string, message: Message): Promise<void> {
		await this.init();
		if (!this.db) throw new Error('DB not initialized');
		return writeMessages(this.db, (store) => {
			store.put(message);
			if (clientMessageId !== message._id) store.delete(clientMessageId);
		});
	}

	async failMessage(message: Message): Promise<void> {
		await this.init();
		if (!this.db) throw new Error('DB not initialized');
		return writeMessages(this.db, (store) => {
			const request = store.get(message._id);
			request.onsuccess = () => {
				const current = request.result as Message | undefined;
				if (current && current.sendState !== 'accepted') store.put({ ...current, ...message });
			};
		});
	}

	async getSendCommand(clientMessageId: string): Promise<Message | null> {
		const pending = await this.getMessage(clientMessageId);
		if (pending?.senderId === this.userId && pending.clientMessageId === clientMessageId)
			return pending;
		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction('messages', 'readonly');
			const request = tx.objectStore('messages').openCursor();
			request.onerror = () => reject(toError(request.error));
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) return resolve(null);
				const message = cursor.value as Message;
				if (message.senderId === this.userId && message.clientMessageId === clientMessageId)
					return resolve(message);
				cursor.continue();
			};
		});
	}

	async getUnfinishedMessages(): Promise<Message[]> {
		await this.init();
		if (!this.db) throw new Error('DB not initialized');
		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction('messages', 'readonly');
			const request = tx.objectStore('messages').openCursor();
			const messages: Message[] = [];
			request.onerror = () => reject(toError(request.error));
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) return resolve(messages);
				const message = cursor.value as Message;
				if (
					message.sendState === 'pending' ||
					message.sendState === 'failed' ||
					message.pendingNotification
				) {
					messages.push(message);
				}
				cursor.continue();
			};
		});
	}

	/**
	 * Get messages for a conversation (between current user and another user)
	 * Returns plaintext messages from local storage
	 *
	 * Uses the compound IDB index ['senderId','receiverId'] for O(k) reads
	 * (k = messages in this conversation) instead of a full-table scan.
	 */
	async getMessages(otherUserId: string, currentUserId: string, limit = 50): Promise<Message[]> {
		await this.init();
		if (!this.db) return [];

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction('messages', 'readonly');
			const store = tx.objectStore('messages');
			const index = store.index('conversation');
			const messages: Message[] = [];

			// Query sent messages: [currentUser → otherUser]
			const sentRange = IDBKeyRange.only([currentUserId, otherUserId]);
			const sentReq = index.openCursor(sentRange);

			sentReq.onerror = () => reject(toError(sentReq.error));
			sentReq.onsuccess = (event: Event) => {
				const cursor = (event.target as IDBRequest).result;
				if (cursor) {
					messages.push(cursor.value as Message);
					cursor.continue();
				} else {
					// Sent cursor exhausted → query received messages: [otherUser → currentUser]
					const recvRange = IDBKeyRange.only([otherUserId, currentUserId]);
					const recvReq = index.openCursor(recvRange);

					recvReq.onerror = () => reject(toError(recvReq.error));
					recvReq.onsuccess = (ev: Event) => {
						const cur = (ev.target as IDBRequest).result;
						if (cur) {
							messages.push(cur.value as Message);
							cur.continue();
						} else {
							// Both cursors done — sort chronologically and return last N
							messages.sort(
								(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
							);
							const recent = new Set(messages.slice(-limit).map((message) => message._id));
							resolve(
								messages.filter(
									(message) =>
										recent.has(message._id) ||
										message.sendState === 'pending' ||
										message.sendState === 'failed'
								)
							);
						}
					};
				}
			};
		});
	}

	/**
	 * Get a single message by ID
	 */
	async getMessage(messageId: string): Promise<Message | null> {
		await this.init();
		if (!this.db) return null;

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction('messages', 'readonly');
			const store = tx.objectStore('messages');
			const request = store.get(messageId);

			request.onerror = () => reject(toError(request.error));
			request.onsuccess = (ev: Event) => resolve((ev.target as IDBRequest).result || null);
		});
	}

	/**
	 * Check if a message exists in local storage
	 */
	async hasMessage(messageId: string): Promise<boolean> {
		const message = await this.getMessage(messageId);
		return message !== null;
	}

	/**
	 * Delete all messages for a specific conversation
	 */
	async deleteConversation(otherUserId: string, currentUserId: string): Promise<void> {
		await this.init();
		if (!this.db) return;

		const messages = await this.getMessages(otherUserId, currentUserId, Number.MAX_SAFE_INTEGER);

		if (!messages.length) return;
		return writeMessages(this.db, (store) => {
			for (const message of messages) store.delete(message._id);
		});
	}

	/**
	 * Clear all messages (useful for logout/cleanup)
	 */
	async clearAll(): Promise<void> {
		await this.init();
		if (!this.db) return;

		return writeMessages(this.db, (store) => {
			store.clear();
		});
	}
}

// Export factory function
let currentStore: LocalMessageStore | null = null;
let currentStoreUserId: string | null = null;

export function getMessageStore(userId: string): LocalMessageStore {
	if (!currentStore || currentStoreUserId !== userId) {
		currentStore = new LocalMessageStore(userId);
		currentStoreUserId = userId;
	}
	return currentStore;
}

/**
 * Clear all local message storage for a user
 * Useful for debugging or resetting encryption state
 */
export async function clearAllLocalMessages(userId: string): Promise<void> {
	const store = getMessageStore(userId);
	await store.clearAll();
	logger.info(`[MessageStore] Cleared all local messages for user ${userId}`);
}

/**
 * Delete the entire IndexedDB database for a user
 * Use this for a complete reset
 */
export async function deleteMessageDatabase(userId: string): Promise<void> {
	const dbName = `chat-messages-${userId}`;
	return new Promise((resolve, reject) => {
		let settled = false;
		const request = indexedDB.deleteDatabase(dbName);

		request.onerror = () => {
			if (!settled) {
				settled = true;
				reject(toError(request.error));
			}
		};

		request.onsuccess = () => {
			if (!settled) {
				settled = true;
				logger.info(`[MessageStore] Deleted database ${dbName}`);
				resolve();
			}
		};

		request.onblocked = () => {
			logger.warning(`[MessageStore] Database ${dbName} deletion blocked — waiting up to 3 s`);
			setTimeout(() => {
				if (!settled) {
					settled = true;
					logger.warning(
						`[MessageStore] Database ${dbName} deletion timed out while blocked — proceeding anyway`
					);
					resolve();
				}
			}, 3000);
		};
	});
}

export default LocalMessageStore;
