/**
 * AUTO-GENERATED from committed OpenAPI contracts.
 * backendCommit: 489f00d003e2333fa9ba22783dee426af9eab0ee
 * generatorVersion: 1
 */

export type GeneratedResponseMode = 'envelope' | 'raw';
export type GeneratedHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface GeneratedOperationParameter {
	readonly name: string;
	readonly in: 'path' | 'query';
	readonly required: boolean;
	readonly schemaType: 'string' | 'integer' | 'number' | 'boolean';
}

export interface GeneratedApiOperation {
	readonly operationId: string;
	readonly service: 'user' | 'chat';
	readonly method: GeneratedHttpMethod;
	readonly path: string;
	readonly responseMode: GeneratedResponseMode;
	readonly parameters: readonly GeneratedOperationParameter[];
	readonly requestSchema: string | null;
	readonly successSchema: string | null;
}

export const apiOperations = {
	"chat.listConversations": { operationId: "chat.listConversations", service: "chat", method: "GET", path: "/chat/conversations", responseMode: "envelope", parameters: [  ], requestSchema: null, successSchema: "#/components/schemas/ConversationListResponse" } as const,
	"chat.listMessages": { operationId: "chat.listMessages", service: "chat", method: "GET", path: "/chat/get/{receiverId}", responseMode: "envelope", parameters: [ { name: "receiverId", in: "path", required: true, schemaType: "string" }, { name: "limit", in: "query", required: false, schemaType: "integer" }, { name: "offset", in: "query", required: false, schemaType: "integer" } ], requestSchema: null, successSchema: "#/components/schemas/MessagesPageResponse" } as const,
	"user.health": { operationId: "user.health", service: "user", method: "GET", path: "/user/health", responseMode: "raw", parameters: [  ], requestSchema: null, successSchema: "#/components/schemas/HealthCheck" } as const,
	"chat.health": { operationId: "chat.health", service: "chat", method: "GET", path: "/chat/health", responseMode: "raw", parameters: [  ], requestSchema: null, successSchema: "#/components/schemas/HealthCheck" } as const,
	"user.login": { operationId: "user.login", service: "user", method: "POST", path: "/user/login", responseMode: "envelope", parameters: [  ], requestSchema: "#/components/schemas/LoginRequest", successSchema: "#/components/schemas/StatusResponse" } as const,
	"user.logout": { operationId: "user.logout", service: "user", method: "POST", path: "/user/logout", responseMode: "envelope", parameters: [  ], requestSchema: null, successSchema: "#/components/schemas/StatusResponse" } as const,
	"user.getCurrentUser": { operationId: "user.getCurrentUser", service: "user", method: "GET", path: "/user/me", responseMode: "envelope", parameters: [  ], requestSchema: null, successSchema: "#/components/schemas/UserResponse" } as const,
	"chat.markAsRead": { operationId: "chat.markAsRead", service: "chat", method: "PUT", path: "/chat/messages/read/{senderId}", responseMode: "envelope", parameters: [ { name: "senderId", in: "path", required: true, schemaType: "string" } ], requestSchema: null, successSchema: "#/components/schemas/MarkReadResponse" } as const,
	"user.metrics": { operationId: "user.metrics", service: "user", method: "GET", path: "/user/metrics", responseMode: "raw", parameters: [  ], requestSchema: null, successSchema: null } as const,
	"chat.metrics": { operationId: "chat.metrics", service: "chat", method: "GET", path: "/chat/metrics", responseMode: "raw", parameters: [  ], requestSchema: null, successSchema: null } as const,
	"user.publishPrekey": { operationId: "user.publishPrekey", service: "user", method: "POST", path: "/user/prekeys", responseMode: "envelope", parameters: [  ], requestSchema: "#/components/schemas/PublishPrekeyRequest", successSchema: "#/components/schemas/StatusResponse" } as const,
	"user.consumePrekey": { operationId: "user.consumePrekey", service: "user", method: "GET", path: "/user/prekeys/{userId}", responseMode: "envelope", parameters: [ { name: "userId", in: "path", required: true, schemaType: "string" } ], requestSchema: null, successSchema: "#/components/schemas/ConsumedPrekeyResponse" } as const,
	"user.register": { operationId: "user.register", service: "user", method: "POST", path: "/user/register", responseMode: "envelope", parameters: [  ], requestSchema: "#/components/schemas/RegisterRequest", successSchema: "#/components/schemas/UserResponse" } as const,
	"user.searchUsers": { operationId: "user.searchUsers", service: "user", method: "GET", path: "/user/search", responseMode: "envelope", parameters: [ { name: "q", in: "query", required: true, schemaType: "string" } ], requestSchema: null, successSchema: "#/components/schemas/UserListResponse" } as const,
	"chat.sendMessage": { operationId: "chat.sendMessage", service: "chat", method: "POST", path: "/chat/send", responseMode: "envelope", parameters: [  ], requestSchema: "#/components/schemas/SendMessageRequest", successSchema: "#/components/schemas/MessageResponse" } as const,
	"user.fetchSignalKeys": { operationId: "user.fetchSignalKeys", service: "user", method: "GET", path: "/user/signal-keys", responseMode: "envelope", parameters: [ { name: "deviceId", in: "query", required: true, schemaType: "string" } ], requestSchema: null, successSchema: "#/components/schemas/SignalKeyBackupResponse" } as const,
	"user.storeSignalKeys": { operationId: "user.storeSignalKeys", service: "user", method: "POST", path: "/user/signal-keys", responseMode: "envelope", parameters: [  ], requestSchema: "#/components/schemas/SignalKeyBackupRequest", successSchema: "#/components/schemas/StatusResponse" } as const,
	"user.getById": { operationId: "user.getById", service: "user", method: "GET", path: "/user/users/{userId}", responseMode: "envelope", parameters: [ { name: "userId", in: "path", required: true, schemaType: "string" } ], requestSchema: null, successSchema: "#/components/schemas/UserResponse" } as const,
} as const satisfies Record<string, GeneratedApiOperation>;
