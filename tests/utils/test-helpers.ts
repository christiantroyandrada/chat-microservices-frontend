/**
 * Common test utilities and helpers
 */

import { writable, type Writable } from 'svelte/store';
import type { User, Message, ChatConversation } from '$lib/types';

/**
 * Create a mock user for testing
 */
export function createMockUser(overrides?: Partial<User>): User {
	return {
		_id: 'test-user-id',
		username: 'testuser',
		email: 'test@example.com',
		...overrides
	};
}

/**
 * Create a mock message for testing
 */
export function createMockMessage(overrides?: Partial<Message>): Message {
	return {
		_id: 'test-message-id',
		senderId: 'sender-id',
		receiverId: 'receiver-id',
		content: 'Test message content',
		timestamp: new Date().toISOString(),
		read: false,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides
	};
}

/**
 * Create a mock conversation for testing
 */
export function createMockConversation(overrides?: Partial<ChatConversation>): ChatConversation {
	return {
		userId: 'other-user-id',
		username: 'otheruser',
		lastMessage: 'Last message content',
		lastMessageTime: new Date().toISOString(),
		unreadCount: 0,
		...overrides
	};
}

/**
 * Create a mock Svelte store
 */
export function createMockStore<T>(initialValue: T): Writable<T> {
	return writable(initialValue);
}

/**
 * Wait for a specific amount of time (for async operations)
 */
export function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock fetch response
 */
export function createMockResponse<T>(data: T, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => data,
		text: async () => JSON.stringify(data),
		headers: new Headers(),
		statusText: status === 200 ? 'OK' : 'Error'
	} as Response;
}

/**
 * Create a mock WebSocket for testing
 */
export class MockWebSocket {
	public readyState: number = WebSocket.CONNECTING;
	public url: string;
	private eventListeners: Map<string, Array<(data?: unknown) => void>> = new Map();

	constructor(url: string) {
		this.url = url;
		// Simulate connection after a short delay
		setTimeout(() => {
			this.readyState = WebSocket.OPEN;
			this.dispatchEvent('open', {});
		}, 10);
	}

	addEventListener(event: string, callback: (data?: unknown) => void) {
		if (!this.eventListeners.has(event)) {
			this.eventListeners.set(event, []);
		}
		this.eventListeners.get(event)!.push(callback);
	}

	removeEventListener(event: string, callback: (data?: unknown) => void) {
		const listeners = this.eventListeners.get(event);
		if (listeners) {
			const index = listeners.indexOf(callback);
			if (index > -1) {
				listeners.splice(index, 1);
			}
		}
	}

	dispatchEvent(event: string, data?: unknown) {
		const listeners = this.eventListeners.get(event);
		if (listeners) {
			listeners.forEach((callback) => callback(data));
		}
	}

	send(): void {
		// Mock send - no-op in tests
	}

	close() {
		this.readyState = WebSocket.CLOSED;
		this.dispatchEvent('close', {});
	}
}

/**
 * Setup common test environment
 */
export function setupTestEnvironment() {
	// Mock localStorage
	const localStorageMock = {
		store: {} as Record<string, string>,
		getItem(key: string) {
			return this.store[key] || null;
		},
		setItem(key: string, value: string) {
			this.store[key] = value.toString();
		},
		removeItem(key: string) {
			delete this.store[key];
		},
		clear() {
			this.store = {};
		}
	};

	if (typeof globalThis.global !== 'undefined') {
		Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
	}

	return localStorageMock;
}
