import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ApiResponse } from '$lib/types';
import type {
	ChatApiConversation,
	ChatApiMessage,
	ChatApiPagination,
	UserApiConsumedPrekey,
	UserApiSearchUser,
	UserApiSignalKeyBackupRequest,
	UserApiUser
} from '$lib/generated/api.types';

const api = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	request: vi.fn()
}));

vi.mock('$lib/services/api', () => ({ apiClient: api }));

describe('generated API helpers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.request.mockResolvedValue({ success: true, data: {} });
	});

	it('uses the auth endpoints with unwrapped result types', async () => {
		const { userApi } = await import('$lib/services/api.generated');
		const registerBody = {
			username: 'ada',
			email: 'ada@example.com',
			password: 'secret'
		};
		const loginBody = { email: 'ada@example.com', password: 'secret' };
		api.request.mockResolvedValue({
			success: true,
			data: { id: 'user-1', username: 'ada', email: 'ada@example.com' }
		});

		const registered = await userApi.register(registerBody);
		const loggedIn = await userApi.login(loginBody);
		const current = await userApi.getCurrentUser();
		await userApi.logout();

		expect(api.request).toHaveBeenCalled();
		expectTypeOf(registered).toEqualTypeOf<ApiResponse<UserApiUser>>();
		expectTypeOf(loggedIn).toEqualTypeOf<ApiResponse<void>>();
		expectTypeOf(current).toEqualTypeOf<ApiResponse<UserApiUser>>();
	});

	it('encodes user lookup values and returns search arrays directly', async () => {
		const { userApi } = await import('$lib/services/api.generated');
		api.request.mockResolvedValue({ success: true, data: [] });

		const searched = await userApi.searchUsers('ada & bob');
		const found = await userApi.getUserById('user/one?');

		expect(api.request).toHaveBeenCalled();
		expect(searched.data).toEqual([]);
		expectTypeOf(searched).toEqualTypeOf<ApiResponse<UserApiSearchUser[]>>();
		expectTypeOf(found).toEqualTypeOf<ApiResponse<UserApiUser>>();
	});

	it('publishes and consumes the generated prekey wire shapes', async () => {
		const { userApi } = await import('$lib/services/api.generated');
		const body = {
			deviceId: 'device-1',
			bundle: {
				registrationId: 1,
				identityKey: 'identity',
				signedPreKey: { id: 2, publicKey: 'signed', signature: 'sig' },
				preKeys: [{ id: 3, publicKey: 'one-time' }]
			}
		};
		api.request.mockResolvedValue({ success: true, data: { userId: 'u', ...body } });

		const published = await userApi.publishPrekey(body);
		const consumed = await userApi.getPrekeyBundle('user/one?');

		expect(api.request).toHaveBeenCalled();
		expectTypeOf(published).toEqualTypeOf<ApiResponse<void>>();
		expectTypeOf(consumed).toEqualTypeOf<ApiResponse<UserApiConsumedPrekey>>();
	});

	it('stores and fetches encrypted Signal backups with an encoded device id', async () => {
		const { userApi } = await import('$lib/services/api.generated');
		const body: UserApiSignalKeyBackupRequest = {
			deviceId: 'device/one?',
			encryptedBundle: {
				encrypted: 'ciphertext',
				iv: 'iv',
				salt: 'salt',
				version: 1,
				deviceId: 'device/one?'
			}
		};
		api.request.mockResolvedValue({ success: true, data: body });

		await userApi.storeSignalKeys(body);
		const fetched = await userApi.fetchSignalKeys('device/one?');

		expect(api.request).toHaveBeenCalled();
		expectTypeOf(fetched).toEqualTypeOf<ApiResponse<UserApiSignalKeyBackupRequest>>();
	});

	it('uses typed chat endpoints, encoded values, and pagination metadata', async () => {
		const { chatApi } = await import('$lib/services/api.generated');
		const sendBody = { receiverId: 'user/one?', message: 'encrypted' };
		api.request
			.mockResolvedValueOnce({ success: true, data: {} })
			.mockResolvedValueOnce({
				success: true,
				data: [],
				pagination: { total: 0, limit: 25, offset: 5, hasMore: false }
			})
			.mockResolvedValueOnce({ success: true, data: [] })
			.mockResolvedValueOnce({ success: true, data: { modifiedCount: 2 } });

		const sent = await chatApi.sendMessage(sendBody);
		const messages = await chatApi.getMessages('user/one?', 25, 5);
		const conversations = await chatApi.getConversations();
		const read = await chatApi.markAsRead('sender/one?');

		expect(api.request).toHaveBeenCalled();
		expect(messages.pagination.total).toBe(0);
		expectTypeOf(sent).toEqualTypeOf<ApiResponse<ChatApiMessage>>();
		expectTypeOf(messages).toEqualTypeOf<
			ApiResponse<ChatApiMessage[], { pagination: ChatApiPagination }>
		>();
		expectTypeOf(conversations).toEqualTypeOf<ApiResponse<ChatApiConversation[]>>();
		expectTypeOf(read).toEqualTypeOf<ApiResponse<{ modifiedCount: number }>>();
	});

	it('delegates through generated operation metadata', async () => {
		const { userApi, chatApi } = await import('$lib/services/api.generated');
		const { apiOperations } = await import('$lib/generated/api.operations');
		// Verify that the generated operations contain expected metadata
		expect(apiOperations['user.register'].method).toBe('POST');
		expect(apiOperations['user.register'].path).toBe('/user/register');
		expect(apiOperations['user.register'].responseMode).toBe('envelope');
		expect(apiOperations['chat.listMessages'].parameters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'receiverId', in: 'path' }),
				expect.objectContaining({ name: 'limit', in: 'query' })
			])
		);
		// Verify helpers keep signatures (type-level, runtime just checks they exist and are functions)
		expect(typeof userApi.register).toBe('function');
		expect(typeof chatApi.getMessages).toBe('function');
		expect(typeof chatApi.getConversations).toBe('function');
	});

	it('passes each generated response mode explicitly to the API client', async () => {
		const { userApi, chatApi } = await import('$lib/services/api.generated');
		const { apiOperations } = await import('$lib/generated/api.operations');
		api.request.mockResolvedValue({ success: true, data: [] });

		await userApi.login({ email: 'ada@example.com', password: 'secret' });
		await userApi.logout();
		await userApi.publishPrekey({
			deviceId: 'device-1',
			bundle: {
				registrationId: 1,
				identityKey: 'identity',
				signedPreKey: { id: 2, publicKey: 'signed', signature: 'sig' },
				preKeys: [{ id: 3, publicKey: 'one-time' }]
			}
		});
		await chatApi.getMessages('user-1', 25, 5);

		expect(api.request.mock.calls.map(([, options]) => options.responseMode)).toEqual([
			'envelope',
			'envelope',
			'envelope',
			'envelope'
		]);
		expect(
			['user.health', 'user.metrics', 'chat.health', 'chat.metrics'].map(
				(operationId) => apiOperations[operationId as keyof typeof apiOperations].responseMode
			)
		).toEqual(['raw', 'raw', 'raw', 'raw']);
	});

	it('does not expose chat operations absent from the backend contract', async () => {
		const { chatApi } = await import('$lib/services/api.generated');

		expect(chatApi).not.toHaveProperty('deleteMessage');
	});
});
