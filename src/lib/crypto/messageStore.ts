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

class LocalMessageStore {
	private dbName: string;
	private version = 1;
	private db: IDBDatabase | null = null;

	constructor(userId: string) {
		// Each user gets their own database
		this.dbName = `chat-messages-${userId}`;
	}

	async init(): Promise<void> {
		if (this.db) return;

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, this.version);

			request.onerror = () => reject(request.error);
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

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction('messages', 'readwrite');
			const store = tx.objectStore('messages');
			const request = store.put(message);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	/**
	 * Save multiple messages in a batch
	 */
	async saveMessages(messages: Message[]): Promise<void> {
		await this.init();
		if (!this.db) throw new Error('DB not initialized');

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction('messages', 'readwrite');
			const store = tx.objectStore('messages');

			let completed = 0;
			const total = messages.length;

			if (total === 0) {
				resolve();
				return;
			}

			messages.forEach((message) => {
				const request = store.put(message);
				request.onsuccess = () => {
					completed++;
					if (completed === total) resolve();
				};
				request.onerror = () => reject(request.error);
			});
		});
	}

	/**
	 * Get messages for a conversation (between current user and another user)
	 * Returns plaintext messages from local storage
	 */
	async getMessages(otherUserId: string, currentUserId: string, limit = 50): Promise<Message[]> {
		await this.init();
		if (!this.db) return [];

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction('messages', 'readonly');
			const store = tx.objectStore('messages');
			const messages: Message[] = [];

			const request = store.openCursor();

			request.onerror = () => reject(request.error);
			request.onsuccess = (event: Event) => {
				const cursor = (event.target as IDBRequest).result;
				if (cursor) {
					const message = cursor.value as Message;
					// Check if message is part of this conversation
					const isOutgoing =
						message.senderId === currentUserId && message.receiverId === otherUserId;
					const isIncoming =
						message.senderId === otherUserId && message.receiverId === currentUserId;

					if (isOutgoing || isIncoming) {
						messages.push(message);
					}

					cursor.continue();
				} else {
					// Sort by timestamp and limit
					messages.sort(
						(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
					);
					resolve(messages.slice(-limit)); // Get last N messages
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

			request.onerror = () => reject(request.error);
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

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction('messages', 'readwrite');
			const store = tx.objectStore('messages');

			let completed = 0;
			const total = messages.length;

			if (total === 0) {
				resolve();
				return;
			}

			messages.forEach((message) => {
				const request = store.delete(message._id);
				request.onsuccess = () => {
					completed++;
					if (completed === total) resolve();
				};
				request.onerror = () => reject(request.error);
			});
		});
	}

	/**
	 * Clear all messages (useful for logout/cleanup)
	 */
	async clearAll(): Promise<void> {
		await this.init();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction('messages', 'readwrite');
			const store = tx.objectStore('messages');
			const request = store.clear();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
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
	console.log(`[MessageStore] Cleared all local messages for user ${userId}`);
}

/**
 * Delete the entire IndexedDB database for a user
 * Use this for a complete reset
 */
export async function deleteMessageDatabase(userId: string): Promise<void> {
	const dbName = `chat-messages-${userId}`;
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(dbName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			console.log(`[MessageStore] Deleted database ${dbName}`);
			resolve();
		};
		request.onblocked = () => {
			console.warn(`[MessageStore] Database ${dbName} deletion blocked - close all tabs`);
		};
	});
}

export default LocalMessageStore;
