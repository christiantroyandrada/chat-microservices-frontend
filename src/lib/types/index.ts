// User Types
// Used by: auth.service.ts, auth.store.ts, components (ChatHeader, ChatList)
export interface User {
	_id: string;
	username: string;
	email: string;
	createdAt?: string;
	updatedAt?: string;
}

// Used by: auth.service.ts - login/register responses
export interface AuthUser extends User {
	token: string;
}

// Used by: login/+page.svelte, auth.service.ts
export interface LoginCredentials {
	email: string;
	password: string;
}

// Used by: register/+page.svelte, auth.service.ts
export interface RegisterCredentials {
	username: string;
	email: string;
	password: string;
}

// Message Types
// Used by: chat.service.ts, websocket.service.ts, messageStore.ts, MessageList.svelte
export interface Message {
	_id: string;
	senderId: string;
	senderUsername?: string;
	receiverId: string;
	content: string;
	timestamp: string;
	read?: boolean;
	createdAt?: string;
	updatedAt?: string;
}

// Used by: chat/+page.svelte, MessageInput.svelte
export interface SendMessagePayload {
	receiverId: string;
	content: string;
}

// Used by: chat.service.ts, chat.store.ts, ChatList.svelte
export interface ChatConversation {
	userId: string;
	username: string;
	lastMessage?: string;
	lastMessageSenderId?: string;
	lastMessageTime?: string;
	unreadCount?: number;
	// Presence tracking via websocket
	online?: boolean;
	lastSeen?: string; // ISO timestamp of last activity
}

// Chat store state
// Used by: chat.store.ts
export interface ChatState {
	conversations: ChatConversation[];
	messages: Record<string, Message[]>;
	selectedUserId: string | null;
	loading: {
		conversations: boolean;
		messages: boolean;
	};
}

// Notification Types
// Used by: notification.service.ts, notification.store.ts, NotificationModal.svelte
export interface Notification {
	_id: string;
	userId: string;
	type: 'message' | 'system' | 'alert';
	title: string;
	message: string;
	read: boolean;
	createdAt: string;
}

// Used by: notification.service.ts
export interface NotificationPayload {
	type: 'message' | 'system' | 'alert';
	title: string;
	message: string;
}

// WebSocket Types
// Used by: websocket.service.ts (deprecated - using typed events now)
export interface WebSocketMessage {
	type: 'message' | 'typing' | 'online' | 'offline';
	data: Message | { userId: string; username?: string; isTyping?: boolean };
}

// API Response Types
// Used by: api.ts for all API client methods
export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	message?: string;
	error?: string;
}

// Shape of normalized responses parsed by the frontend API client
// Used by: api.ts internally for response normalization
export type ResponseShape = {
	data?: unknown;
	message?: string;
	error?: string;
	errors?: unknown;
	[k: string]: unknown;
};

// WebSocket payload shapes
// Used by: websocket.service.ts for incoming message payloads
export type ReceiveMessagePayload = Record<string, unknown>;
export type TypingPayload = { userId?: string; isTyping?: boolean };

// Used by: api.ts for error handling
export interface ApiError {
	message: string;
	status?: number;
	errors?: Record<string, string[]> | Array<{ field: string; message: string }>;
}

// Store / State Types
// Used by: auth.store.ts
export interface AuthState {
	user: User | null;
	loading: boolean;
	error: string | null;
}

// Notification store state
// Used by: notification.store.ts
export interface NotificationState {
	notifications: Notification[];
	unreadCount: number;
	loading: boolean;
}

// Server-derived message shape (backend -> frontend normalization)
// Used by: chat.service.ts, websocket.service.ts for normalizing backend responses
export interface ServerMessage {
	_id?: string;
	id?: string;
	senderId: string;
	senderUsername?: string;
	senderName?: string;
	receiverId: string;
	message?: string;
	content?: string;
	timestamp?: string;
	createdAt?: string;
	read?: boolean;
	isRead?: boolean;
	updatedAt?: string;
}

// Toast/Alert Types
// Used by: toast.store.ts, Toast.svelte
export interface Toast {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
}

// Theme
// Used by: theme.store.ts, ThemeToggle.svelte
export type Theme = 'dark' | 'light';

// Service result helper used by client services
// Used by: Various service methods for consistent return types
export type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

// Component / callback helper types
// Used by: chat/+page.svelte for MessageList ref
export type MessageListHandle = {
	scrollToLatest?: (options?: { behavior?: ScrollBehavior }) => Promise<void> | void;
};

// Used by: websocket.service.ts for event callbacks
export type MessageCallback = (message: Message) => void;
export type StatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void;
export type TypingCallback = (userId: string, isTyping: boolean) => void;
export type PresenceCallback = (userId: string, online: boolean, lastSeen?: string) => void;

// Signal Protocol Types
// Used by: auth.service.ts, signal.ts for key backup/restore
export interface SignalKeySet {
	identityKeyPair: {
		pubKey: string;
		privKey: string;
	};
	registrationId: number;
	signedPreKeyPair: {
		keyId: number;
		keyPair: {
			pubKey: string;
			privKey: string;
		};
		signature: string;
	};
	preKeys: Array<{
		keyId: number;
		keyPair: {
			pubKey: string;
			privKey: string;
		};
	}>;
}

// Encrypted key bundle for secure backend storage
// Client-side encryption ensures server never sees plaintext keys
export interface EncryptedKeyBundle {
	encrypted: string; // Base64-encoded encrypted data
	iv: string; // Base64-encoded initialization vector
	salt: string; // Base64-encoded salt for key derivation
	version: number; // Encryption version for future upgrades
	deviceId: string; // Device ID for key isolation
}
