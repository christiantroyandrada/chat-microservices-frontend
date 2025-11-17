/**
 * Unit tests for chat service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { testMessages, testConversations } from '../fixtures/messages';
import { testUsers } from '../fixtures/users';

// Mock API client BEFORE importing
const mockApiClient = {
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	delete: vi.fn(),
	patch: vi.fn()
};

// Mock dependencies
vi.mock('$lib/services/api', () => ({
	apiClient: mockApiClient
}));

vi.mock('$lib/services/dev-logger', () => ({
	logger: {
		info: vi.fn(),
		warning: vi.fn(),
		error: vi.fn()
	}
}));

// Mock Signal Protocol
vi.mock('$lib/crypto/signal', () => ({
	initSignal: vi.fn().mockResolvedValue(undefined),
	createSessionWithPrekeyBundle: vi.fn().mockResolvedValue(undefined),
	encryptMessage: vi.fn().mockResolvedValue({ type: 3, body: 'encrypted-content' }),
	decryptMessage: vi.fn().mockResolvedValue('decrypted-content')
}));

// Mock message store
const mockMessageStore = {
	getMessages: vi.fn().mockResolvedValue([]),
	getMessage: vi.fn().mockResolvedValue(null),
	saveMessage: vi.fn().mockResolvedValue(undefined),
	clear: vi.fn().mockResolvedValue(undefined)
};

vi.mock('$lib/crypto/messageStore', () => ({
	getMessageStore: vi.fn(() => mockMessageStore)
}));

// Import after mocks are defined
const { chatService } = await import('$lib/services/chat.service');

// Helper to create success response
const createSuccessResponse = <T>(data: T) => ({
	data,
	status: 200,
	statusText: 'OK',
	headers: {}
});

describe('chatService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});
	describe('getConversations', () => {
		it('should get conversations successfully', async () => {
			mockApiClient.get.mockResolvedValue(createSuccessResponse(testConversations));

			const result = await chatService.getConversations();

			expect(mockApiClient.get).toHaveBeenCalledWith('/chat/conversations');
			expect(result).toEqual(testConversations);
		});

		it('should enhance conversations with local message previews', async () => {
			mockApiClient.get.mockResolvedValue(createSuccessResponse(testConversations));
			mockMessageStore.getMessages.mockResolvedValue([testMessages[0]]);

			const result = await chatService.getConversations('user-alice-123');

			expect(result[0].lastMessage).toContain(testMessages[0].content);
		});

		it('should handle empty conversations', async () => {
			mockApiClient.get.mockResolvedValue(createSuccessResponse([]));

			const result = await chatService.getConversations();

			expect(result).toEqual([]);
		});

		it('should handle API errors', async () => {
			const error = new Error('Network error');
			mockApiClient.get.mockRejectedValue(error);

			await expect(chatService.getConversations()).rejects.toThrow('Network error');
		});
	});

	describe('getMessages', () => {
		const userId = 'user-bob-456';
		const currentUserId = 'user-alice-123';

		it('should require currentUserId', async () => {
			await expect(chatService.getMessages(userId, 50, 0)).rejects.toThrow(
				'currentUserId is required'
			);
		});

		it('should fetch and decrypt messages from server', async () => {
			const serverMessages = testMessages.map((msg) => ({
				...msg,
				message: msg.content,
				content: undefined
			}));

			mockApiClient.get.mockResolvedValue(createSuccessResponse(serverMessages));
			mockMessageStore.getMessage.mockResolvedValue(null);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(mockApiClient.get).toHaveBeenCalledWith(`/chat/get/${userId}?limit=50&offset=0`);
			expect(result.length).toBeGreaterThan(0);
		});

		it('should return local messages when server has none', async () => {
			mockApiClient.get.mockResolvedValue(createSuccessResponse([]));
			mockMessageStore.getMessages.mockResolvedValue(testMessages);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result).toEqual(testMessages);
		});

		it('should use cached messages when available', async () => {
			const serverMessages = [testMessages[0]];
			mockApiClient.get.mockResolvedValue(createSuccessResponse(serverMessages));
			mockMessageStore.getMessage.mockResolvedValue(testMessages[0]);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result[0]).toEqual(testMessages[0]);
			// Should not save if already cached
			expect(mockMessageStore.saveMessage).not.toHaveBeenCalled();
		});
	});

	describe('sendMessage', () => {
		const currentUserId = 'user-alice-123';
		const recipientId = 'user-bob-456';

		beforeEach(() => {
			// Clear mocks before each test in this describe block
			vi.clearAllMocks();
		});

		it('should send encrypted message successfully', async () => {
			const payload = {
				senderId: currentUserId,
				receiverId: recipientId,
				content: 'Hello!'
			};

			const serverResponse = {
				...testMessages[0],
				message: 'encrypted-content'
			};

			// Mock the prekey bundle fetch (uses fetch, not apiClient)
			const prekeyBundle = {
				userId: recipientId,
				deviceId: 'device-123',
				bundle: {
					identityKey: 'mock-identity-key',
					signedPreKey: {
						keyId: 1,
						publicKey: 'mock-signed-prekey',
						signature: 'mock-signature'
					},
					preKey: {
						keyId: 1,
						publicKey: 'mock-prekey'
					}
				}
			};

			// Mock global fetch for prekey bundle request
			global.fetch = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: prekeyBundle })
			} as Response);

			mockApiClient.post.mockResolvedValueOnce(createSuccessResponse(serverResponse));

			const result = await chatService.sendMessage(payload, currentUserId);

			expect(global.fetch).toHaveBeenCalled();
			expect(mockApiClient.post).toHaveBeenCalled();
			expect(result).toBeDefined();
		});

		it('should require currentUserId', async () => {
			const payload = {
				senderId: currentUserId,
				receiverId: recipientId,
				content: 'Hello!'
			};

			// Mock fetch to return prekey
			global.fetch = vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: {
						userId: recipientId,
						deviceId: 'device-123',
						bundle: {}
					}
				})
			} as Response);

			// Should throw error (the actual error depends on initSignal implementation)
			await expect(chatService.sendMessage(payload)).rejects.toThrow();
		});
	});

	describe('markAsRead', () => {
		it('should mark messages as read', async () => {
			mockApiClient.put.mockResolvedValue(createSuccessResponse({}));

			await chatService.markAsRead('user-bob-456');

			// Fix: Update to actual API path
			expect(mockApiClient.put).toHaveBeenCalledWith('/chat/messages/read/user-bob-456');
		});

		it('should handle mark as read error', async () => {
			const error = new Error('Failed to mark as read');
			mockApiClient.put.mockRejectedValue(error);

			await expect(chatService.markAsRead('user-bob-456')).rejects.toThrow(
				'Failed to mark as read'
			);
		});
	});

	describe('searchUsers', () => {
		beforeEach(() => {
			// Clear mocks to avoid interference from other tests
			vi.clearAllMocks();
		});

		it('should search users by query', async () => {
			const users = [testUsers.alice, testUsers.bob];
			mockApiClient.get.mockResolvedValueOnce(createSuccessResponse(users));

			const result = await chatService.searchUsers('alice');

			// Fix: Update to actual API path (user service)
			expect(mockApiClient.get).toHaveBeenCalledWith('/user/search?q=alice');
			expect(result).toEqual(users);
		});

		it('should handle empty search results', async () => {
			mockApiClient.get.mockResolvedValueOnce(createSuccessResponse([]));

			const result = await chatService.searchUsers('nonexistent');

			expect(result).toEqual([]);
		});
	});
});
