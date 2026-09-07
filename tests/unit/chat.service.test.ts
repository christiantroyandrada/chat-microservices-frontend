/**
 * Unit tests for chat service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ContractBoundaryError } from '$lib/services/contract-boundary';
import type {
	ChatApiConversation,
	ChatApiMessage,
	UserApiSearchUser
} from '$lib/generated/api.types';
import type { ApiResponse } from '$lib/types';
import { testMessages, testConversations } from '../fixtures/messages';
import { testUsers } from '../fixtures/users';

// Mock typed endpoint helpers BEFORE importing the domain service
const mockUserApi = {
	getPrekeyBundle: vi.fn(),
	searchUsers: vi.fn()
};
const mockChatApi = {
	getConversations: vi.fn(),
	getMessages: vi.fn(),
	sendMessage: vi.fn(),
	markAsRead: vi.fn()
};

// Mock dependencies
vi.mock('$lib/services/api.generated', () => ({
	userApi: mockUserApi,
	chatApi: mockChatApi
}));

const mockLogger = {
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
	debug: vi.fn(),
	request: vi.fn(),
	requestor: vi.fn()
};

vi.mock('$lib/services/dev-logger', () => ({
	logger: mockLogger
}));

// Custom error class for Signal decryption errors
class MockSignalDecryptionError extends Error {
	constructor(
		message: string,
		public details?: unknown
	) {
		super(message);
		this.name = 'SignalDecryptionError';
	}
}

// Mock Signal Protocol
vi.mock('$lib/crypto/signal', () => ({
	initSignal: vi.fn().mockResolvedValue(undefined),
	createSessionWithPrekeyBundle: vi.fn().mockResolvedValue(undefined),
	encryptMessage: vi.fn().mockResolvedValue({ type: 3, body: 'encrypted-content' }),
	decryptMessage: vi.fn().mockResolvedValue('decrypted-content'),
	hasSession: vi.fn().mockResolvedValue(false),
	SignalDecryptionError: MockSignalDecryptionError
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
	success: true,
	data
});

const toConversationWire = (conversations: typeof testConversations) =>
	conversations.map(({ userId, username, ...conversation }) => ({
		...conversation,
		id: userId,
		name: username,
		avatar: null
	}));

describe('chatService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('does not expose unsupported message deletion', () => {
		expect(chatService).not.toHaveProperty('deleteMessage');
	});

	describe('getConversations', () => {
		it('should get conversations successfully', async () => {
			mockChatApi.getConversations.mockResolvedValue(
				createSuccessResponse(toConversationWire(testConversations))
			);

			const result = await chatService.getConversations();

			expect(result).toEqual(testConversations);
		});

		it('should enhance conversations with local message previews', async () => {
			mockChatApi.getConversations.mockResolvedValue(
				createSuccessResponse(toConversationWire(testConversations))
			);
			mockMessageStore.getMessages.mockResolvedValue([testMessages[0]]);

			const result = await chatService.getConversations('user-alice-123');

			expect(result[0].lastMessage).toContain(testMessages[0].content);
		});

		it('should handle empty conversations', async () => {
			mockChatApi.getConversations.mockResolvedValue(createSuccessResponse([]));

			const result = await chatService.getConversations();

			expect(result).toEqual([]);
		});

		it('should handle API errors', async () => {
			const error = new Error('Network error');
			mockChatApi.getConversations.mockRejectedValue(error);

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
				status: 'Seen' as const,
				message: msg.content,
				content: undefined
			}));

			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse(serverMessages));
			mockMessageStore.getMessage.mockResolvedValue(null);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result).toHaveLength(serverMessages.length);
			expect(result[0]).toMatchObject({
				_id: serverMessages[0]._id,
				content: serverMessages[0].message
			});
		});

		it('should return local messages when server has none', async () => {
			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse([]));
			mockMessageStore.getMessages.mockResolvedValue(testMessages);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result).toEqual(testMessages);
		});

		it('should use cached messages when available', async () => {
			const serverMessages = [
				{ ...testMessages[0], status: 'Seen' as const, message: testMessages[0].content }
			];
			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse(serverMessages));
			mockMessageStore.getMessage.mockResolvedValue(testMessages[0]);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result[0]).toEqual(testMessages[0]);
			// Should not save if already cached
			expect(mockMessageStore.saveMessage).not.toHaveBeenCalled();
		});

		it('should NOT retry cached PreKeyWhisperMessage (type 3) decryption failure', async () => {
			// A type-3 (PreKeyWhisperMessage) retry would consume the OPK from the local
			// Signal store while the server still publishes that OPK ID — causing Bad MAC
			// for the next peer who uses it.  The service must leave these as-is.
			const type3Envelope = JSON.stringify({ __encrypted: true, type: 3, body: 'QUJDREVG' });
			const cachedFailedMsg = {
				...testMessages[0],
				content: '🔒 Message could not be decrypted.',
				_decryptionFailed: true,
				_encryptedContent: type3Envelope
			};

			mockChatApi.getMessages.mockResolvedValue(
				createSuccessResponse([
					{ ...testMessages[0], status: 'Seen' as const, message: testMessages[0].content }
				])
			);
			mockMessageStore.getMessage.mockResolvedValue(cachedFailedMsg);

			const signal = await import('$lib/crypto/signal');
			vi.mocked(signal.decryptMessage).mockResolvedValue('decrypted content');

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			// decryptMessage must NOT be called — retrying would consume the OPK
			expect(signal.decryptMessage).not.toHaveBeenCalled();
			// The cached (failed) message is returned as-is
			expect(result[0]).toEqual(cachedFailedMsg);
		});

		it('should NOT retry type-3 even when _encryptedContent is missing (fallback to server content)', async () => {
			// Old cached messages from before the _encryptedContent fix won't have the
			// metadata field.  The guard must fall back to parsing msg.content (the fresh
			// server response) to detect type-3 envelopes.
			const type3Envelope = JSON.stringify({ __encrypted: true, type: 3, body: 'QUJDREVG' });
			const cachedFailedMsg = {
				...testMessages[0],
				content: '🔒 Message could not be decrypted.',
				_decryptionFailed: true
				// NOTE: no _encryptedContent — simulates old cached message
			};

			// Server still sends the original encrypted envelope
			const serverMsg = {
				...testMessages[0],
				status: 'Seen' as const,
				content: type3Envelope,
				message: type3Envelope
			};
			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse([serverMsg]));
			mockMessageStore.getMessage.mockResolvedValue(cachedFailedMsg);

			const signal = await import('$lib/crypto/signal');
			vi.mocked(signal.decryptMessage).mockResolvedValue('decrypted content');

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			// decryptMessage must NOT be called — server content is type-3
			expect(signal.decryptMessage).not.toHaveBeenCalled();
			expect(result[0]).toEqual(cachedFailedMsg);
		});

		it('should retry cached WhisperMessage (type 1) decryption failure', async () => {
			// Type-1 (WhisperMessage) doesn't use an OPK so retry is safe when keys are
			// restored after an earlier failed attempt.
			const type1Envelope = JSON.stringify({ __encrypted: true, type: 1, body: 'QUJDREVG' });
			const cachedFailedMsg = {
				...testMessages[0],
				content: '🔒 Message could not be decrypted.',
				_decryptionFailed: true,
				_encryptedContent: type1Envelope
			};

			mockChatApi.getMessages.mockResolvedValue(
				createSuccessResponse([
					{ ...testMessages[0], status: 'Seen' as const, message: testMessages[0].content }
				])
			);
			mockMessageStore.getMessage.mockResolvedValue(cachedFailedMsg);

			const signal = await import('$lib/crypto/signal');
			vi.mocked(signal.decryptMessage).mockResolvedValue('retried decrypted content');

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			// decryptMessage should be called for type-1 retries
			expect(signal.decryptMessage).toHaveBeenCalled();
			expect(result[0].content).toBe('retried decrypted content');
		});

		it('should handle unencrypted plaintext messages', async () => {
			const plainMessage = {
				...testMessages[0],
				status: 'Seen' as const,
				message: 'plain text content',
				content: 'plain text content'
			};

			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse([plainMessage]));
			mockMessageStore.getMessage.mockResolvedValue(null);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result.length).toBe(1);
			expect(mockMessageStore.saveMessage).toHaveBeenCalled();
		});

		it('should handle encrypted messages with __encrypted flag', async () => {
			const encryptedContent = JSON.stringify({
				__encrypted: true,
				body: 'QUJDREVG' // base64 encoded
			});

			const encryptedMessage = {
				...testMessages[0],
				status: 'Seen' as const,
				content: encryptedContent,
				message: encryptedContent
			};

			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse([encryptedMessage]));
			mockMessageStore.getMessage.mockResolvedValue(null);

			// Import the signal mock
			const signal = await import('$lib/crypto/signal');
			vi.mocked(signal.decryptMessage).mockResolvedValue('decrypted content');

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result.length).toBe(1);
			expect(signal.decryptMessage).toHaveBeenCalled();
		});

		it('should skip decryption for invalid base64 body', async () => {
			const invalidEncrypted = JSON.stringify({
				__encrypted: true,
				body: 'not-valid-base64!@#$'
			});

			const message = {
				...testMessages[0],
				status: 'Seen' as const,
				content: invalidEncrypted,
				message: invalidEncrypted
			};

			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse([message]));
			mockMessageStore.getMessage.mockResolvedValue(null);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result.length).toBe(1);
			// Should save without decryption
			expect(mockMessageStore.saveMessage).toHaveBeenCalled();
		});

		it('should handle decryption errors gracefully', async () => {
			const encryptedContent = JSON.stringify({
				__encrypted: true,
				body: 'QUJDREVG'
			});

			const encryptedMessage = {
				...testMessages[0],
				status: 'Seen' as const,
				content: encryptedContent,
				message: encryptedContent
			};

			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse([encryptedMessage]));
			mockMessageStore.getMessage.mockResolvedValue(null);

			const signal = await import('$lib/crypto/signal');
			vi.mocked(signal.decryptMessage).mockRejectedValue(new Error('Decryption failed'));

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			// Should still return the message with error content
			expect(result.length).toBe(1);
			expect(result[0].content).toContain('Message could not be decrypted');
		});

		it('should handle messages sent by current user (cannot decrypt own messages)', async () => {
			const encryptedContent = JSON.stringify({
				__encrypted: true,
				body: 'QUJDREVG'
			});

			const ownMessage = {
				...testMessages[0],
				status: 'Seen' as const,
				senderId: currentUserId, // Current user sent this message
				content: encryptedContent,
				message: encryptedContent
			};

			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse([ownMessage]));
			mockMessageStore.getMessage.mockResolvedValue(null);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result.length).toBe(1);
			expect(result[0].content).toContain('Your encrypted message');
			expect(mockMessageStore.saveMessage).toHaveBeenCalled();
		});

		it('should normalize different server message field names', async () => {
			const serverMessage = {
				id: 'msg-123',
				senderId: 'user-bob-456',
				senderName: 'Bob',
				receiverId: currentUserId,
				message: 'Hello from server',
				createdAt: '2024-01-01T00:00:00Z',
				status: 'Delivered' as const,
				isRead: false
			};

			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse([serverMessage]));
			mockMessageStore.getMessage.mockResolvedValue(null);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result.length).toBe(1);
			expect(result[0]._id).toBe('msg-123');
			expect(result[0].senderUsername).toBe('Bob');
			expect(result[0].content).toBe('Hello from server');
		});

		it('maps each backend delivery status to its client status and read state', async () => {
			const serverMessages = [
				{
					...testMessages[0],
					status: 'NotDelivered' as const,
					read: true,
					message: 'queued',
					content: undefined
				},
				{
					...testMessages[0],
					_id: 'message-delivered',
					status: 'Delivered' as const,
					isRead: true,
					message: 'delivered',
					content: undefined
				},
				{
					...testMessages[0],
					_id: 'message-seen',
					status: 'Seen' as const,
					read: false,
					message: 'seen',
					content: undefined
				}
			];
			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse(serverMessages));
			mockMessageStore.getMessage.mockResolvedValue(null);

			const result = await chatService.getMessages(userId, 50, 0, currentUserId);

			expect(result.map(({ status, read }) => ({ status, read }))).toEqual([
				{ status: 'sent', read: false },
				{ status: 'delivered', read: false },
				{ status: 'read', read: true }
			]);
		});

		it('rejects a server message missing the required delivery status', async () => {
			const malformedMessage = {
				...testMessages[0],
				message: 'missing status',
				content: undefined
			};
			mockChatApi.getMessages.mockResolvedValue(createSuccessResponse([malformedMessage]));
			mockMessageStore.getMessage.mockResolvedValue(null);

			await expect(chatService.getMessages(userId, 50, 0, currentUserId)).rejects.toThrow(
				'chat.getMessages: status must be NotDelivered, Delivered, or Seen'
			);
		});
	});

	describe('sendMessage', () => {
		const currentUserId = 'user-alice-123';
		const recipientId = 'user-bob-456';

		beforeEach(() => {
			// Clear mocks before each test in this describe block
			vi.clearAllMocks();
		});

		it('encrypts, normalizes, and stores a sent message', async () => {
			const payload = {
				senderId: currentUserId,
				receiverId: recipientId,
				content: 'Hello!'
			};

			const serverResponse = {
				...testMessages[0],
				status: 'NotDelivered' as const,
				message: 'encrypted-content'
			};

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

			mockUserApi.getPrekeyBundle.mockResolvedValueOnce(createSuccessResponse(prekeyBundle));
			mockChatApi.sendMessage.mockResolvedValueOnce(createSuccessResponse(serverResponse));

			const result = await chatService.sendMessage(payload, currentUserId);

			expect(mockChatApi.sendMessage).toHaveBeenCalledWith({
				receiverId: recipientId,
				message: JSON.stringify({ __encrypted: true, type: 3, body: 'encrypted-content' })
			});
			expect(result).toMatchObject({
				_id: serverResponse._id,
				content: 'Hello!'
			});
			expect(mockMessageStore.saveMessage).toHaveBeenCalledWith(result);
		});

		it('does not swallow a prekey request failure', async () => {
			const payload = { receiverId: 'uncached-recipient', content: 'Hello!' };
			const failure = new Error('Prekey service unavailable');
			mockUserApi.getPrekeyBundle.mockRejectedValueOnce(failure);

			await expect(chatService.sendMessage(payload, currentUserId)).rejects.toBe(failure);
		});

		it('should require currentUserId', async () => {
			const payload = {
				senderId: currentUserId,
				receiverId: recipientId,
				content: 'Hello!'
			};

			// When no currentUserId is passed, initSignal receives undefined
			// which should fail in production — simulate by making the mock throw
			const signal = await import('$lib/crypto/signal');
			vi.mocked(signal.initSignal).mockRejectedValueOnce(
				new Error('currentUserId is required for Signal init')
			);

			// Should throw error because initSignal rejects
			await expect(chatService.sendMessage(payload)).rejects.toThrow();
		});
	});

	describe('markAsRead', () => {
		it('should mark messages as read', async () => {
			mockChatApi.markAsRead.mockResolvedValue(createSuccessResponse({ modifiedCount: 1 }));

			await expect(chatService.markAsRead('user-bob-456')).resolves.toBeUndefined();
		});

		it('should handle mark as read error', async () => {
			const error = new Error('Failed to mark as read');
			mockChatApi.markAsRead.mockRejectedValue(error);

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

		it('preserves the generated search user shape', async () => {
			const users = [testUsers.alice, testUsers.bob];
			mockUserApi.searchUsers.mockResolvedValueOnce(createSuccessResponse(users));

			const result = await chatService.searchUsers('alice');

			expect(result).toEqual(users);
			expect(result[0]).toEqual({
				_id: 'user-alice-123',
				username: 'alice',
				email: 'alice@test.com'
			});
		});

		it('should handle empty search results', async () => {
			mockUserApi.searchUsers.mockResolvedValueOnce(createSuccessResponse([]));

			const result = await chatService.searchUsers('nonexistent');

			expect(result).toEqual([]);
		});
	});

	describe('domain boundaries', () => {
		const userId = 'user-bob-456';
		const currentUserId = 'user-alice-123';

		it('throws when getConversations response data is not array', async () => {
			const { chatService } = await import('$lib/services/chat.service');
			mockChatApi.getConversations.mockResolvedValue({
				success: true,
				data: {} as unknown as ChatApiConversation[]
			});
			await expect(chatService.getConversations()).rejects.toBeInstanceOf(ContractBoundaryError);
		});

		it('throws when getConversations data is missing', async () => {
			const { chatService } = await import('$lib/services/chat.service');
			mockChatApi.getConversations.mockResolvedValue({ success: true } as unknown as ApiResponse<
				ChatApiConversation[]
			>);
			await expect(chatService.getConversations()).rejects.toBeInstanceOf(ContractBoundaryError);
		});

		it('throws when conversation missing id', async () => {
			const badConv = {
				name: 'bob',
				avatar: null,
				lastMessage: 'hi',
				unreadCount: 0,
				lastMessageTime: new Date().toISOString()
			} as unknown as ChatApiConversation;
			mockChatApi.getConversations.mockResolvedValue({
				success: true,
				data: [badConv]
			} as unknown as ApiResponse<ChatApiConversation[]>);
			await expect(chatService.getConversations()).rejects.toThrow(
				'chat.getConversations: id must be non-empty string'
			);
		});

		it('throws when conversation missing name', async () => {
			const badConv = {
				id: 'user-1',
				avatar: null,
				lastMessage: 'hi',
				unreadCount: 0,
				lastMessageTime: new Date().toISOString()
			} as unknown as ChatApiConversation;
			mockChatApi.getConversations.mockResolvedValue({
				success: true,
				data: [badConv]
			} as unknown as ApiResponse<ChatApiConversation[]>);
			await expect(chatService.getConversations()).rejects.toThrow(
				'chat.getConversations: name must be non-empty string'
			);
		});

		it('throws when conversation unreadCount is not finite number', async () => {
			const badConv = {
				id: 'user-1',
				name: 'bob',
				avatar: null,
				lastMessage: 'hi',
				unreadCount: 'not-a-number',
				lastMessageTime: new Date().toISOString()
			} as unknown as ChatApiConversation;
			mockChatApi.getConversations.mockResolvedValue({
				success: true,
				data: [badConv]
			} as unknown as ApiResponse<ChatApiConversation[]>);
			await expect(chatService.getConversations()).rejects.toThrow(
				'chat.getConversations: unreadCount must be finite number'
			);
		});

		it('throws when getMessages data is not array', async () => {
			mockChatApi.getMessages.mockResolvedValue({
				success: true,
				data: {} as unknown as ChatApiMessage[]
			} as unknown as ApiResponse<ChatApiMessage[]>);
			await expect(chatService.getMessages(userId, 50, 0, currentUserId)).rejects.toBeInstanceOf(
				ContractBoundaryError
			);
		});

		it('throws when getMessages data missing', async () => {
			mockChatApi.getMessages.mockResolvedValue({ success: true } as unknown as ApiResponse<
				ChatApiMessage[]
			>);
			await expect(chatService.getMessages(userId, 50, 0, currentUserId)).rejects.toBeInstanceOf(
				ContractBoundaryError
			);
		});

		it('throws when server message missing id', async () => {
			const badMsg = {
				senderId: 'a',
				receiverId: 'b',
				status: 'Seen' as const,
				message: 'hi',
				createdAt: new Date().toISOString()
			} as unknown as ChatApiMessage;
			mockChatApi.getMessages.mockResolvedValue({
				success: true,
				data: [badMsg]
			} as unknown as ApiResponse<ChatApiMessage[]>);
			mockMessageStore.getMessage.mockResolvedValue(null);
			await expect(chatService.getMessages(userId, 50, 0, currentUserId)).rejects.toThrow(
				'chat.getMessages: id or _id must be non-empty string'
			);
		});

		it('throws when server message missing status', async () => {
			const badMsg = {
				_id: 'm1',
				senderId: 'a',
				receiverId: 'b',
				message: 'hi'
			} as unknown as ChatApiMessage;
			mockChatApi.getMessages.mockResolvedValue({
				success: true,
				data: [badMsg]
			} as unknown as ApiResponse<ChatApiMessage[]>);
			mockMessageStore.getMessage.mockResolvedValue(null);
			await expect(chatService.getMessages(userId, 50, 0, currentUserId)).rejects.toBeInstanceOf(
				ContractBoundaryError
			);
		});

		it('throws when server message missing content', async () => {
			const badMsg = {
				_id: 'm1',
				senderId: 'a',
				receiverId: 'b',
				status: 'Seen' as const
			} as unknown as ChatApiMessage;
			mockChatApi.getMessages.mockResolvedValue({
				success: true,
				data: [badMsg]
			} as unknown as ApiResponse<ChatApiMessage[]>);
			mockMessageStore.getMessage.mockResolvedValue(null);
			await expect(chatService.getMessages(userId, 50, 0, currentUserId)).rejects.toThrow(
				'chat.getMessages: message/content must be string'
			);
		});

		it('throws when searchUsers data is not array', async () => {
			mockUserApi.searchUsers.mockResolvedValue({
				success: true,
				data: {} as unknown as UserApiSearchUser[]
			} as unknown as ApiResponse<UserApiSearchUser[]>);
			await expect(chatService.searchUsers('alice')).rejects.toBeInstanceOf(ContractBoundaryError);
		});

		it('throws when searchUsers entry missing required field', async () => {
			const badUser = { _id: 'u1', username: 'bob' } as unknown as UserApiSearchUser; // missing email
			mockUserApi.searchUsers.mockResolvedValue({
				success: true,
				data: [badUser]
			} as unknown as ApiResponse<UserApiSearchUser[]>);
			await expect(chatService.searchUsers('bob')).rejects.toThrow(
				'chat.searchUsers: email must be non-empty string'
			);
		});

		it('valid fixtures satisfy generated types', async () => {
			const validConv = {
				id: 'user-2',
				name: 'bob',
				avatar: null,
				lastMessage: 'hello',
				unreadCount: 1,
				lastMessageTime: new Date().toISOString()
			} satisfies ChatApiConversation;
			const validMsg = {
				id: 'msg-1',
				senderId: 'a',
				receiverId: 'b',
				message: 'encrypted',
				isEncrypted: true,
				status: 'Seen' as const,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			} satisfies ChatApiMessage;
			mockChatApi.getConversations.mockResolvedValue({
				success: true,
				data: [validConv]
			} as unknown as ApiResponse<ChatApiConversation[]>);
			mockChatApi.getMessages.mockResolvedValue({
				success: true,
				data: [validMsg]
			} as unknown as ApiResponse<ChatApiMessage[]>);
			mockMessageStore.getMessage.mockResolvedValue(null);
			const convs = await chatService.getConversations();
			expect(convs[0].userId).toBe('user-2');
			const msgs = await chatService.getMessages(userId, 50, 0, currentUserId);
			expect(msgs[0]._id).toBe('msg-1');
		});
	});
});
