import type { Page, Route } from '@playwright/test';

// lightweight id generator to avoid external deps
function genId(prefix = 'id') {
	return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

// helper to parse cookies from request
function parseCookie(cookieHeader?: string | null) {
	const out: Record<string, string> = {};
	if (!cookieHeader) return out;
	cookieHeader.split(';').forEach((c) => {
		const [k, ...v] = c.trim().split('=');
		out[k] = v.join('=');
	});
	return out;
}

type User = {
	id: string;
	name: string;
	email: string;
	password: string;
};

type Conversation = {
	_id: string;
	participants: string[];
	title?: string;
	otherUser?: { _id: string; username?: string; email?: string };
	lastMessage?: { text: string; timestamp: string };
	unreadCount?: number;
};

type Message = {
	_id: string;
	senderId?: string;
	senderUsername?: string;
	text?: string;
	timestamp?: string;
};

// Seeding configuration - tweak these to change how much data is generated per test
const SEED_CONTACTS = 3;
const MESSAGES_PER_CONV = 12; // enough to test scrolling/loading

export async function setupMockBackend(page: Page) {
	// In-memory store for the duration of a single test
	const users = new Map<string, User>();
	// Add a globally-seeded searchable account so tests can find another user
	const seededUserId = `seed-${genId()}`;
	const seededUserEmail = 'e2e.test.user@example.com';
	const seededUser: User = {
		id: seededUserId,
		name: 'E2E Test User',
		email: seededUserEmail,
		password: 'password'
	};
	users.set(seededUserEmail, seededUser);
	// Add a second global seeded account so there are always at least two accounts
	const seededUser2Id = `seed-${genId()}`;
	const seededUser2Email = 'e2e.test.user2@example.com';
	const seededUser2: User = {
		id: seededUser2Id,
		name: 'E2E Second User',
		email: seededUser2Email,
		password: 'password'
	};
	users.set(seededUser2Email, seededUser2);
	const conversationsByUser = new Map<string, Array<Conversation>>();
	const messagesByConversation = new Map<string, Array<Message>>();

	// route handler for user endpoints (delegated to helper)
	await page.route('**/user/**', async (route: Route) =>
		userRouteHandler(route, users, conversationsByUser, messagesByConversation)
	);

	// route handler for chat endpoints (delegated to helper)
	await page.route('**/chat/**', async (route: Route) =>
		chatRouteHandler(route, conversationsByUser, messagesByConversation)
	);
}

// Module-level helper: user route handler extracted from setupMockBackend
async function userRouteHandler(
	route: Route,
	users: Map<string, User>,
	conversationsByUser: Map<string, Array<Conversation>>,
	messagesByConversation: Map<string, Array<Message>>
) {
	const req = route.request();
	const url = req.url();
	const method = req.method().toUpperCase();

	// Delegate to small handlers to reduce cognitive complexity
	if (
		await handleUserRegister(
			route,
			req,
			url,
			method,
			users,
			conversationsByUser,
			messagesByConversation
		)
	)
		return;
	if (await handleUserLogin(route, req, url, method, users)) return;
	if (await handleGetCurrentUser(route, req, url, method, users)) return;
	if (await handleUserSearch(route, url, method, users)) return;

	// Fallback
	return route.continue();
}

async function handleUserRegister(
	route: Route,
	req: ReturnType<Route['request']>,
	url: string,
	method: string,
	users: Map<string, User>,
	conversationsByUser: Map<string, Array<Conversation>>,
	messagesByConversation: Map<string, Array<Message>>
) {
	if (!(url.endsWith('/user/register') && method === 'POST')) return false;
	const body = (await req.postDataJSON()) as Record<string, unknown>;
	const name = String(body['name'] || body['username'] || '').trim();
	const email = String(body['email'] || '')
		.trim()
		.toLowerCase();
	const password = String(body['password'] || '');

	const nameValid = /^[A-Za-z'\-\s]+$/.test(name);
	if (!nameValid) {
		await route.fulfill({
			status: 400,
			contentType: 'application/json',
			body: JSON.stringify({
				status: 400,
				message: 'Validation failed',
				errors: [
					{
						field: 'name',
						message: 'Name can only contain letters, spaces, hyphens, and apostrophes'
					}
				]
			})
		});
		return true;
	}

	if (users.has(email)) {
		await route.fulfill({
			status: 409,
			contentType: 'application/json',
			body: JSON.stringify({ status: 409, message: 'Email already exists' })
		});
		return true;
	}

	const id = `mock-${genId()}`;
	const user: User = { id, name, email, password };
	users.set(email, user);

	const now = Date.now();
	for (let ci = 0; ci < SEED_CONTACTS; ci++) {
		const contactId = `contact-${genId()}`;
		const contactEmail = `contact+${ci}+${Date.now()}@example.com`;
		const contactUser: User = {
			id: contactId,
			name: `${name.split(' ')[0]}'s Contact ${ci + 1}`,
			email: contactEmail,
			password: 'contactpass'
		};
		users.set(contactEmail, contactUser);

		const convId = `conv-${genId()}`;
		const unreadCount = ci === 0 ? 2 : 0;
		const conversation: Conversation = {
			_id: convId,
			participants: [id, contactId],
			title: contactUser.name,
			otherUser: { _id: contactUser.id, username: contactUser.name, email: contactUser.email },
			lastMessage: {
				text: `Seeded conversation ${ci + 1}`,
				timestamp: new Date(now - 60000).toISOString()
			},
			unreadCount
		};

		const listForUser = conversationsByUser.get(id) || [];
		listForUser.push(conversation);
		conversationsByUser.set(id, listForUser);

		const listForContact = conversationsByUser.get(contactId) || [];
		listForContact.push(conversation);
		conversationsByUser.set(contactId, listForContact);

		const messages: Message[] = [];
		for (let m = 0; m < MESSAGES_PER_CONV; m++) {
			const minutesAgo = (MESSAGES_PER_CONV - m) * 5;
			const ts = new Date(now - minutesAgo * 60 * 1000).toISOString();
			const fromContact = m % 2 === 0;
			const senderId = fromContact ? contactUser.id : id;
			const senderUsername = fromContact ? contactUser.name : name;
			messages.push({
				_id: `msg-${genId()}`,
				senderId,
				senderUsername,
				text: `Seeded message ${m + 1} for conv ${ci + 1}`,
				timestamp: ts
			});
		}
		messagesByConversation.set(convId, messages);
	}

	await route.fulfill({
		status: 200,
		headers: { 'Set-Cookie': `jwt=${id}; Path=/; HttpOnly` },
		contentType: 'application/json',
		body: JSON.stringify({
			status: 200,
			message: 'User registered successfully',
			data: { id, name, email }
		})
	});
	return true;
}

async function handleUserLogin(
	route: Route,
	req: ReturnType<Route['request']>,
	url: string,
	method: string,
	users: Map<string, User>
) {
	if (!(url.endsWith('/user/login') && method === 'POST')) return false;
	const body = (await req.postDataJSON()) as Record<string, unknown>;
	const email = String(body['email'] || '')
		.trim()
		.toLowerCase();
	const password = String(body['password'] || '');

	const user = users.get(email);
	if (!user || user.password !== password) {
		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({ status: 401, message: 'Invalid credentials' })
		});
		return true;
	}

	await route.fulfill({
		status: 200,
		headers: { 'Set-Cookie': `jwt=${user.id}; Path=/; HttpOnly` },
		contentType: 'application/json',
		body: JSON.stringify({
			status: 200,
			message: 'Login successful',
			data: { id: user.id, name: user.name, email: user.email }
		})
	});
	return true;
}

async function handleGetCurrentUser(
	route: Route,
	req: ReturnType<Route['request']>,
	url: string,
	method: string,
	users: Map<string, User>
) {
	if (!(url.endsWith('/user/me') && method === 'GET')) return false;
	const cookies = parseCookie(req.headers()['cookie']);
	const jwt = cookies['jwt'];
	if (!jwt) {
		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({ status: 401, message: 'Unauthorized' })
		});
		return true;
	}
	const user = Array.from(users.values()).find((u) => u.id === jwt);
	if (!user) {
		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({ status: 401, message: 'Unauthorized' })
		});
		return true;
	}
	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({
			status: 200,
			data: { id: user.id, username: user.name, email: user.email }
		})
	});
	return true;
}

async function handleUserSearch(
	route: Route,
	url: string,
	method: string,
	users: Map<string, User>
) {
	if (!(url.includes('/user/search') && method === 'GET')) return false;
	const q = new URL(url).searchParams.get('q') || '';
	const results = Array.from(users.values())
		.filter(
			(u) =>
				u.name.toLowerCase().includes(q.toLowerCase()) ||
				u.email.toLowerCase().includes(q.toLowerCase())
		)
		.map((u) => ({ _id: u.id, username: u.name, email: u.email }));
	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({ status: 200, data: results })
	});
	return true;
}

// Module-level helper: chat route handler extracted from setupMockBackend
async function chatRouteHandler(
	route: Route,
	conversationsByUser: Map<string, Array<Conversation>>,
	messagesByConversation: Map<string, Array<Message>>
) {
	const req = route.request();
	const url = req.url();
	const method = req.method().toUpperCase();

	const cookies = parseCookie(req.headers()['cookie']);
	const currentUserId = cookies['jwt'] || null;
	// Delegate to small handlers to reduce complexity
	if (await handleGetConversations(route, url, method, conversationsByUser, currentUserId)) return;
	if (
		await handleGetMessages(
			route,
			url,
			method,
			conversationsByUser,
			messagesByConversation,
			currentUserId
		)
	)
		return;
	if (
		await handlePostSend(
			route,
			url,
			method,
			conversationsByUser,
			messagesByConversation,
			currentUserId
		)
	)
		return;

	return route.continue();
}

async function handleGetConversations(
	route: Route,
	url: string,
	method: string,
	conversationsByUser: Map<string, Array<Conversation>>,
	currentUserId: string | null
) {
	if (!(url.endsWith('/chat/conversations') && method === 'GET')) return false;
	if (!currentUserId) {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ status: 200, data: [] })
		});
		return true;
	}
	const convs = conversationsByUser.get(currentUserId) || [];
	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({ status: 200, data: convs })
	});
	return true;
}

async function handleGetMessages(
	route: Route,
	url: string,
	method: string,
	conversationsByUser: Map<string, Array<Conversation>>,
	messagesByConversation: Map<string, Array<Message>>,
	currentUserId: string | null
) {
	if (!(url.match(/\/chat\/messages\//) && method === 'GET')) return false;
	const parts = url.split('/');
	const last = parts[parts.length - 1];
	if (messagesByConversation.has(last)) {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ status: 200, data: messagesByConversation.get(last) })
		});
		return true;
	}
	if (currentUserId) {
		const convs = conversationsByUser.get(currentUserId) || [];
		const conv = convs.find((c: Conversation) => c.participants.includes(last));
		if (conv && messagesByConversation.has(conv._id)) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ status: 200, data: messagesByConversation.get(conv._id) })
			});
			return true;
		}
	}
	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({ status: 200, data: [] })
	});
	return true;
}

async function handlePostSend(
	route: Route,
	url: string,
	method: string,
	conversationsByUser: Map<string, Array<Conversation>>,
	messagesByConversation: Map<string, Array<Message>>,
	currentUserId: string | null
) {
	if (!(url.endsWith('/chat/send') && method === 'POST')) return false;
	const req = route.request();
	const body = (await req.postDataJSON()) as Record<string, unknown>;
	const convIdFromBody = String(body['conversationId'] || '');
	const recipientId = String(body['recipientId'] || body['to'] || '');
	const text = String(body['text'] || body['message'] || body['content'] || '');

	let convIdToUse = convIdFromBody;
	if (!convIdToUse && currentUserId && recipientId) {
		const convs = conversationsByUser.get(currentUserId) || [];
		const conv = convs.find((c: Conversation) => c.participants.includes(recipientId));
		if (conv) convIdToUse = conv._id;
	}

	if (!convIdToUse) {
		if (!currentUserId || !recipientId) {
			await route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: JSON.stringify({ status: 400, message: 'Missing conversation or recipient' })
			});
			return true;
		}
		convIdToUse = `conv-${genId()}`;
		const newConv: Conversation = {
			_id: convIdToUse,
			participants: [String(currentUserId), recipientId],
			title: 'New Conversation',
			otherUser: { _id: recipientId },
			lastMessage: { text, timestamp: new Date().toISOString() },
			unreadCount: 0
		};
		const list = conversationsByUser.get(String(currentUserId)) || [];
		list.unshift(newConv);
		conversationsByUser.set(String(currentUserId), list);
	}

	const message: Message = {
		_id: `msg-${genId()}`,
		senderId: currentUserId ? String(currentUserId) : undefined,
		senderUsername: 'You',
		text,
		timestamp: new Date().toISOString()
	};
	const msgs = messagesByConversation.get(convIdToUse) || [];
	msgs.push(message);
	messagesByConversation.set(convIdToUse, msgs);

	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({ status: 200, data: message })
	});
	return true;
}

export default setupMockBackend;
