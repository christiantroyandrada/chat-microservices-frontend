// User Types
export interface User {
	_id: string;
	username: string;
	email: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface AuthUser extends User {
	token: string;
}

export interface LoginCredentials {
	email: string;
	password: string;
}

export interface RegisterCredentials {
	username: string;
	email: string;
	password: string;
}

// Message Types
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

export interface SendMessagePayload {
	receiverId: string;
	content: string;
}

export interface ChatConversation {
	userId: string;
	username: string;
	lastMessage?: string;
	lastMessageTime?: string;
	unreadCount?: number;
}

// Chat store state
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
export interface Notification {
	_id: string;
	userId: string;
	type: 'message' | 'system' | 'alert';
	title: string;
	message: string;
	read: boolean;
	createdAt: string;
}

export interface NotificationPayload {
	type: 'message' | 'system' | 'alert';
	title: string;
	message: string;
}

// WebSocket Types
export interface WebSocketMessage {
	type: 'message' | 'typing' | 'online' | 'offline';
	data: Message | { userId: string; username?: string; isTyping?: boolean };
}

// API Response Types
export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	message?: string;
	error?: string;
}

export interface ApiError {
	message: string;
	status?: number;
	errors?: Record<string, string[]> | Array<{ field: string; message: string }>;
}

// Store / State Types
export interface AuthState {
	user: User | null;
	loading: boolean;
	error: string | null;
}

// Notification store state
export interface NotificationState {
	notifications: Notification[];
	unreadCount: number;
	loading: boolean;
}

// Server-derived message shape (backend -> frontend normalization)
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
export interface Toast {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
}

// Theme
export type Theme = 'dark' | 'light';

// Service result helper used by client services
export type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

// Component / callback helper types
export type MessageListHandle = {
	scrollToLatest?: (options?: { behavior?: ScrollBehavior }) => Promise<void> | void;
};

export type MessageCallback = (message: Message) => void;
export type StatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void;
export type TypingCallback = (userId: string, isTyping: boolean) => void;
