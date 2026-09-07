/**
 * Typed API client — the chat-app equivalent of Orkestra's ork-api package.
 *
 * Types are sourced from src/lib/generated/api.types.ts, which is regenerated
 * from the OpenAPI specs by running `pnpm gen:api` (see scripts/gen-api-types.mjs).
 * If the backend adds or renames a field, run `gen:api` and TypeScript will
 * surface any mismatches here at compile time.
 *
 * Usage:
 *   import { userApi, chatApi } from '$lib/services/api.generated'
 *   const user = await userApi.getCurrentUser()    // → ApiResponse<UserApiUser>
 *   const convos = await chatApi.getConversations() // → ApiResponse<ChatApiConversation[]>
 */
import type { ApiResponse } from '$lib/types';
import type {
	UserApiUser,
	UserApiRegisterRequest,
	UserApiLoginRequest,
	UserApiSearchUser,
	UserApiPublishPrekeyRequest,
	UserApiConsumedPrekey,
	UserApiSignalKeyBackupRequest,
	ChatApiMessage,
	ChatApiConversation,
	ChatApiPagination,
	ChatApiSendMessageRequest
} from '$lib/generated/api.types';
import { apiOperations } from '$lib/generated/api.operations';
import { executeOperation } from './api-operation';

// ── User Service endpoints ────────────────────────────────────────────────────
export const userApi = {
	register(body: UserApiRegisterRequest): Promise<ApiResponse<UserApiUser>> {
		return executeOperation<UserApiUser>(apiOperations['user.register'], {}, body);
	},

	login(body: UserApiLoginRequest): Promise<ApiResponse<void>> {
		return executeOperation<void>(apiOperations['user.login'], {}, body);
	},

	getCurrentUser(): Promise<ApiResponse<UserApiUser>> {
		return executeOperation<UserApiUser>(apiOperations['user.getCurrentUser'], {});
	},

	logout(): Promise<ApiResponse<void>> {
		return executeOperation<void>(apiOperations['user.logout'], {});
	},

	searchUsers(q: string): Promise<ApiResponse<UserApiSearchUser[]>> {
		return executeOperation<UserApiSearchUser[]>(apiOperations['user.searchUsers'], { q });
	},

	getUserById(userId: string): Promise<ApiResponse<UserApiUser>> {
		return executeOperation<UserApiUser>(apiOperations['user.getById'], { userId });
	},

	storeSignalKeys(body: UserApiSignalKeyBackupRequest): Promise<ApiResponse<void>> {
		return executeOperation<void>(apiOperations['user.storeSignalKeys'], {}, body);
	},

	fetchSignalKeys(deviceId: string): Promise<ApiResponse<UserApiSignalKeyBackupRequest>> {
		return executeOperation<UserApiSignalKeyBackupRequest>(apiOperations['user.fetchSignalKeys'], {
			deviceId
		});
	},

	publishPrekey(body: UserApiPublishPrekeyRequest): Promise<ApiResponse<void>> {
		return executeOperation<void>(apiOperations['user.publishPrekey'], {}, body);
	},

	getPrekeyBundle(userId: string): Promise<ApiResponse<UserApiConsumedPrekey>> {
		return executeOperation<UserApiConsumedPrekey>(apiOperations['user.consumePrekey'], { userId });
	}
} as const;

// ── Chat Service endpoints ────────────────────────────────────────────────────
export const chatApi = {
	sendMessage(body: ChatApiSendMessageRequest): Promise<ApiResponse<ChatApiMessage>> {
		return executeOperation<ChatApiMessage>(apiOperations['chat.sendMessage'], {}, body);
	},

	getMessages(
		receiverId: string,
		limit = 50,
		offset = 0
	): Promise<ApiResponse<ChatApiMessage[], { pagination: ChatApiPagination }>> {
		return executeOperation<ChatApiMessage[], { pagination: ChatApiPagination }>(
			apiOperations['chat.listMessages'],
			{ receiverId, limit, offset }
		);
	},

	getConversations(): Promise<ApiResponse<ChatApiConversation[]>> {
		return executeOperation<ChatApiConversation[]>(apiOperations['chat.listConversations'], {});
	},

	markAsRead(senderId: string): Promise<ApiResponse<{ modifiedCount: number }>> {
		return executeOperation<{ modifiedCount: number }>(apiOperations['chat.markAsRead'], {
			senderId
		});
	}
} as const;
