import type { Page, Request, Route } from '@playwright/test';
import type {
	ChatApiConversation,
	ChatApiConversationListResponse,
	ChatApiMarkReadResponse,
	ChatApiMessagesPageResponse,
	ChatApiMessage,
	ChatApiSendMessageRequest,
	UserApiSearchUser,
	UserApiStatusResponse,
	UserApiUser,
	UserApiUserListResponse,
	UserApiUserResponse
} from '$lib/generated/api.types';

type UserRecord = UserApiUser & { password: string };

export const mockOwnerId = '234689c4-035b-42ca-9830-ff18c3f2b070';
export const mockContactOneId = 'c2011193-c43c-45bd-acaa-435f3b73bc09';
export const mockContactTwoId = '08f1bb42-340c-43f0-bd6f-8e4de3bb3905';

export const outboxOwnerId = 'f067bcfe-3c78-49c8-bf23-0a9edb0bc731';
export const outboxRecipientId = '6e4c26d9-d497-4082-8527-c75b0b778ae2';
type SendState = {
	messages: Map<string, ChatApiMessage>;
	commands: ChatApiSendMessageRequest[];
	loseFirstResponse: boolean;
};

const owner = {
	id: mockOwnerId,
	username: 'e2eowner',
	email: 'owner@example.com',
	password: 'TestPass123!'
} satisfies UserRecord;

const existingUser = {
	id: 'ce6be9bf-3682-484c-9029-417f6ef21c41',
	username: 'existinguser',
	email: 'existing@example.com',
	password: 'TestPass123!'
} satisfies UserRecord;

const contacts = [
	{
		id: mockContactOneId,
		username: 'E2E Contact One',
		email: 'contact.one@example.com',
		password: 'TestPass123!'
	},
	{
		id: mockContactTwoId,
		username: 'E2E Contact Two',
		email: 'contact.two@example.com',
		password: 'TestPass123!'
	},
	{
		id: 'ac5d802b-08cf-40f6-ab95-61495fe91e48',
		username: 'E2E Search User',
		email: 'search.user@example.com',
		password: 'TestPass123!'
	}
] satisfies UserRecord[];

const seededConversations = [
	{
		id: contacts[0].id,
		name: contacts[0].username,
		avatar: null,
		lastMessage: 'First sealed letter',
		unreadCount: 2,
		lastMessageTime: '2026-09-16T00:00:00.000Z'
	},
	{
		id: contacts[1].id,
		name: contacts[1].username,
		avatar: null,
		lastMessage: 'Second sealed letter',
		unreadCount: 0,
		lastMessageTime: '2026-09-15T00:00:00.000Z'
	}
] satisfies ChatApiConversation[];

function parseCookies(request: Request) {
	return Object.fromEntries(
		(request.headers()['cookie'] ?? '')
			.split(';')
			.map((cookie) => cookie.trim().split('='))
			.filter(([name, value]) => name && value)
	);
}

function publicUser(user: UserRecord): UserApiUser {
	return { id: user.id, username: user.username, email: user.email };
}

function authenticatedUser(request: Request, users: Map<string, UserRecord>) {
	const id = parseCookies(request).jwt;
	return id ? Array.from(users.values()).find((user) => user.id === id) : undefined;
}

async function fulfill(
	route: Route,
	status: number,
	body: unknown,
	headers?: Record<string, string>
) {
	await route.fulfill({
		status,
		contentType: 'application/json',
		headers,
		body: JSON.stringify(body)
	});
}

async function unauthorized(route: Route) {
	await fulfill(route, 401, { status: 401, message: 'Unauthorized' });
}

export async function setupMockBackend(page: Page, options = { loseFirstSendResponse: false }) {
	const users = new Map(
		[
			owner,
			existingUser,
			...contacts,
			{
				id: outboxOwnerId,
				username: 'Outbox Owner',
				email: 'outbox@example.com',
				password: 'TestPass123!'
			},
			{
				id: outboxRecipientId,
				username: 'Outbox Recipient',
				email: 'recipient@example.com',
				password: 'TestPass123!'
			}
		].map((user) => [user.email, { ...user }] as const)
	);
	const conversations = new Map<string, ChatApiConversation[]>([
		[owner.id, seededConversations.map((conversation) => ({ ...conversation }))]
	]);

	await page.route('**/user/**', (route) => handleUserRoute(route, users));
	const state: SendState = {
		messages: new Map(),
		commands: [],
		loseFirstResponse: options.loseFirstSendResponse
	};
	await page.route('**/chat/**', (route) => handleChatRoute(route, users, conversations, state));
	return state;
}

async function handleUserRoute(route: Route, users: Map<string, UserRecord>) {
	const request = route.request();
	const { pathname, searchParams } = new URL(request.url());
	const method = request.method();

	if (pathname === '/user/register' && method === 'POST') {
		const body = (await request.postDataJSON()) as Record<string, unknown>;
		const username = String(body.username ?? '')
			.trim()
			.toLowerCase();
		const email = String(body.email ?? '')
			.trim()
			.toLowerCase();
		const password = String(body.password ?? '');
		if (users.has(email)) {
			await fulfill(route, 409, { status: 409, message: 'Email already exists' });
			return;
		}

		const user = { id: crypto.randomUUID(), username, email, password } satisfies UserRecord;
		users.set(email, user);
		const response = {
			status: 200,
			message: 'User registered successfully',
			data: publicUser(user)
		} satisfies UserApiUserResponse;
		await fulfill(route, 200, response, {
			'Set-Cookie': `jwt=${user.id}; Path=/; HttpOnly; SameSite=Lax`
		});
		return;
	}

	if (pathname === '/user/login' && method === 'POST') {
		const body = (await request.postDataJSON()) as Record<string, unknown>;
		const user = users.get(
			String(body.email ?? '')
				.trim()
				.toLowerCase()
		);
		if (!user || user.password !== String(body.password ?? '')) {
			await fulfill(route, 401, { status: 401, message: 'Invalid credentials' });
			return;
		}

		const response = { status: 200, message: 'Login successful' } satisfies UserApiStatusResponse;
		await fulfill(route, 200, response, {
			'Set-Cookie': `jwt=${user.id}; Path=/; HttpOnly; SameSite=Lax`
		});
		return;
	}

	if (pathname === '/user/logout' && method === 'POST') {
		const response = { status: 200, message: 'Logout successful' } satisfies UserApiStatusResponse;
		await fulfill(route, 200, response, {
			'Set-Cookie': 'jwt=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax'
		});
		return;
	}

	const currentUser = authenticatedUser(request, users);
	if (pathname === '/user/me' && method === 'GET') {
		if (!currentUser) return unauthorized(route);
		const response = {
			status: 200,
			message: 'Current user',
			data: publicUser(currentUser)
		} satisfies UserApiUserResponse;
		await fulfill(route, 200, response);
		return;
	}

	if (pathname === '/user/search' && method === 'GET') {
		if (!currentUser) return unauthorized(route);
		const query = (searchParams.get('q') ?? '').toLowerCase();
		const data = Array.from(users.values())
			.filter(
				(user) =>
					user.id !== currentUser.id &&
					(user.username.toLowerCase().includes(query) || user.email.toLowerCase().includes(query))
			)
			.map(
				(user) =>
					({ _id: user.id, username: user.username, email: user.email }) satisfies UserApiSearchUser
			);
		const response = { status: 200, data } satisfies UserApiUserListResponse;
		await fulfill(route, 200, response);
		return;
	}

	await route.continue();
}

async function handleChatRoute(
	route: Route,
	users: Map<string, UserRecord>,
	conversations: Map<string, ChatApiConversation[]>,
	state: SendState
) {
	const request = route.request();
	const { pathname, searchParams } = new URL(request.url());
	const method = request.method();
	const currentUser = authenticatedUser(request, users);
	if (
		currentUser &&
		searchParams.has('expectedUserId') &&
		searchParams.get('expectedUserId') !== currentUser.id
	) {
		await fulfill(route, 403, { status: 403, message: 'Account changed' });
		return;
	}

	if (pathname === '/chat/send' && method === 'POST') {
		if (!currentUser) return unauthorized(route);
		const body = request.postDataJSON() as ChatApiSendMessageRequest;
		state.commands.push(body);
		if (body.expectedSenderId !== currentUser.id) {
			await fulfill(route, 403, { status: 403, message: 'Account changed' });
			return;
		}
		const key = `${currentUser.id}:${body.clientMessageId}`;
		const existing = state.messages.get(key);
		if (
			existing &&
			(existing.message !== body.message || existing.receiverId !== body.receiverId)
		) {
			await fulfill(route, 409, { status: 409, message: 'Conflicting command' });
			return;
		}
		const message: ChatApiMessage = existing ?? {
			id: crypto.randomUUID(),
			senderId: currentUser.id,
			receiverId: body.receiverId,
			clientMessageId: body.clientMessageId,
			message: body.message,
			isEncrypted: true,
			status: 'NotDelivered',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
		state.messages.set(key, message);
		const currentConversations = conversations.get(currentUser.id) ?? [];
		if (!currentConversations.some((conversation) => conversation.id === body.receiverId)) {
			currentConversations.push({
				id: body.receiverId,
				name: [...users.values()].find((user) => user.id === body.receiverId)?.username ?? 'User',
				avatar: null,
				lastMessage: '',
				lastMessageTime: message.createdAt,
				unreadCount: 0
			});
			conversations.set(currentUser.id, currentConversations);
		}
		if (!existing && state.loseFirstResponse) {
			state.loseFirstResponse = false;
			await route.abort('failed');
			return;
		}
		await fulfill(route, 200, { status: 200, data: message });
		return;
	}

	if (pathname === '/chat/conversations' && method === 'GET') {
		if (!currentUser) return unauthorized(route);
		const response = {
			status: 200,
			message: 'Conversations retrieved',
			data: conversations.get(currentUser.id) ?? []
		} satisfies ChatApiConversationListResponse;
		await fulfill(route, 200, response);
		return;
	}

	const messagesMatch = /^\/chat\/get\/([^/]+)$/.exec(pathname);
	if (messagesMatch && method === 'GET') {
		if (!currentUser) return unauthorized(route);
		const receiverId = decodeURIComponent(messagesMatch[1]);
		if (!(conversations.get(currentUser.id) ?? []).some((item) => item.id === receiverId)) {
			await fulfill(route, 404, { status: 404, message: 'Conversation not found' });
			return;
		}

		const limit = Number(searchParams.get('limit') ?? 50);
		const offset = Number(searchParams.get('offset') ?? 0);
		const messages = [...state.messages.values()].filter(
			(message) =>
				(message.senderId === currentUser.id && message.receiverId === receiverId) ||
				(message.senderId === receiverId && message.receiverId === currentUser.id)
		);
		const response = {
			status: 200,
			message: 'Messages retrieved',
			data: messages.slice(offset, offset + limit),
			pagination: {
				total: messages.length,
				limit,
				offset,
				hasMore: offset + limit < messages.length
			}
		} satisfies ChatApiMessagesPageResponse;
		await fulfill(route, 200, response);
		return;
	}

	const readMatch = /^\/chat\/messages\/read\/([^/]+)$/.exec(pathname);
	if (readMatch && method === 'PUT') {
		if (!currentUser) return unauthorized(route);
		const senderId = decodeURIComponent(readMatch[1]);
		const currentConversations = conversations.get(currentUser.id) ?? [];
		if (!currentConversations.some((item) => item.id === senderId)) {
			await fulfill(route, 404, { status: 404, message: 'Conversation not found' });
			return;
		}

		conversations.set(
			currentUser.id,
			currentConversations.map((item) =>
				item.id === senderId ? { ...item, unreadCount: 0 } : item
			)
		);
		const response = {
			status: 200,
			message: 'Messages marked as read',
			data: { modifiedCount: 1 }
		} satisfies ChatApiMarkReadResponse;
		await fulfill(route, 200, response);
		return;
	}

	await route.continue();
}

export default setupMockBackend;
