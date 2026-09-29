import type { Page, Request, Route } from '@playwright/test';
import type {
	ChatApiConversation,
	ChatApiConversationListResponse,
	ChatApiMarkReadResponse,
	ChatApiMessagesPageResponse,
	UserApiSearchUser,
	UserApiStatusResponse,
	UserApiUser,
	UserApiUserListResponse,
	UserApiUserResponse
} from '$lib/generated/api.types';

type UserRecord = UserApiUser & { password: string };

const owner = {
	id: 'user-owner',
	username: 'e2eowner',
	email: 'owner@example.com',
	password: 'TestPass123!'
} satisfies UserRecord;

const existingUser = {
	id: 'user-existing',
	username: 'existinguser',
	email: 'existing@example.com',
	password: 'TestPass123!'
} satisfies UserRecord;

const contacts = [
	{
		id: 'contact-one',
		username: 'E2E Contact One',
		email: 'contact.one@example.com',
		password: 'TestPass123!'
	},
	{
		id: 'contact-two',
		username: 'E2E Contact Two',
		email: 'contact.two@example.com',
		password: 'TestPass123!'
	},
	{
		id: 'search-user',
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

export async function setupMockBackend(page: Page) {
	const users = new Map(
		[owner, existingUser, ...contacts].map((user) => [user.email, { ...user }] as const)
	);
	const conversations = new Map<string, ChatApiConversation[]>([
		[owner.id, seededConversations.map((conversation) => ({ ...conversation }))]
	]);

	await page.route('**/user/**', (route) => handleUserRoute(route, users));
	await page.route('**/chat/**', (route) => handleChatRoute(route, users, conversations));
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

		const user = { id: 'registered-user', username, email, password } satisfies UserRecord;
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
	conversations: Map<string, ChatApiConversation[]>
) {
	const request = route.request();
	const { pathname, searchParams } = new URL(request.url());
	const method = request.method();
	const currentUser = authenticatedUser(request, users);

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
		const response = {
			status: 200,
			message: 'Messages retrieved',
			data: [],
			pagination: { total: 0, limit, offset, hasMore: false }
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
