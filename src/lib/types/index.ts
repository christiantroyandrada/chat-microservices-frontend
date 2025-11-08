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

// Toast/Alert Types
export interface Toast {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
}
