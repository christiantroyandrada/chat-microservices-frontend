/**

 * AUTO-GENERATED from committed OpenAPI contracts.

 * backendCommit: 1e40c0895ccee1dbc7718dff41eefd7fbfcd0cb3

 * generatorVersion: 1

 */

export interface UserApiRegisterRequest {
	username: string;
	email: string;
	password: string;
}

export interface UserApiLoginRequest {
	email: string;
	password: string;
}

export interface UserApiStatusResponse {
	status: number;
	message: string;
}

export interface UserApiUser {
	id: string;
	username: string;
	email: string;
}

export interface UserApiUserResponse {
	status: number;
	message: string;
	data: UserApiUser;
}

export interface UserApiSearchUser {
	_id: string;
	username: string;
	email: string;
}

export interface UserApiUserListResponse {
	status: number;
	data: UserApiSearchUser[];
}

export interface UserApiSignedPreKey {
	id: number;
	publicKey: string;
	signature: string;
}

export interface UserApiOneTimePreKey {
	id: number;
	publicKey: string;
}

/** Signal Protocol X3DH prekey bundle */
export interface UserApiPrekeyBundle {
	/** Base64-encoded identity public key */
	identityKey: string;
	signedPreKey: UserApiSignedPreKey;
	preKeys: UserApiOneTimePreKey[];
	registrationId: number;
}

export interface UserApiPublishPrekeyRequest {
	deviceId: string;
	bundle: UserApiPrekeyBundle;
}

export interface UserApiConsumedPrekey {
	userId: string;
	deviceId: string;
	bundle: UserApiPrekeyBundle;
}

export interface UserApiConsumedPrekeyResponse {
	status: number;
	data: UserApiConsumedPrekey;
}

export interface UserApiSignalKeyBackupRequest {
	deviceId: string;
	encryptedBundle: {
		encrypted: string;
		iv: string;
		salt: string;
		version: number;
		deviceId: string;
	};
}

export interface UserApiSignalKeyBackupResponse {
	status: number;
	data: UserApiSignalKeyBackupRequest;
}

export interface UserApiHealthCheck {
	status?: "ok" | "degraded" | "error";
	service?: string;
	checks?: {
		database?: boolean;
		rabbitmq?: boolean;
	};
}

export interface ChatApiSendMessageRequest {
	receiverId: string;
	/** Signal-protocol encrypted envelope (JSON string, max 5000 chars) */
	message: string;
}

export interface ChatApiMessage {
	id: string;
	senderId: string;
	receiverId: string;
	/** Encrypted envelope JSON string */
	message: string;
	isEncrypted: boolean;
	status: "NotDelivered" | "Delivered" | "Seen";
	createdAt: string;
	updatedAt: string;
}

export interface ChatApiConversation {
	id: string;
	name: string;
	avatar: string | null;
	lastMessage: string;
	unreadCount: number;
	lastMessageTime: string;
}

export interface ChatApiPagination {
	total: number;
	limit: number;
	offset: number;
	hasMore: boolean;
}

export interface ChatApiMessageResponse {
	status: number;
	message: string;
	data: ChatApiMessage;
}

export interface ChatApiMessagesPageResponse {
	status: number;
	message: string;
	data: ChatApiMessage[];
	pagination: ChatApiPagination;
}

export interface ChatApiConversationListResponse {
	status: number;
	message: string;
	data: ChatApiConversation[];
}

export interface ChatApiMarkReadResponse {
	status: number;
	message: string;
	data: {
		modifiedCount: number;
	};
}

export interface ChatApiHealthCheck {
	status?: "ok" | "degraded" | "error";
	service?: string;
	checks?: {
		database?: boolean;
		rabbitmq?: boolean;
		redis?: boolean | null;
	};
}
