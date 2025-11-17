import type { Page, Route } from '@playwright/test';

// lightweight id generator to avoid external deps
function genId(prefix = 'id') {
	return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
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

	// route handler for user endpoints
	await page.route('**/user/**', async (route: Route) => {
		const req = route.request();
		const url = req.url();
		const method = req.method().toUpperCase();

		// POST /user/register
		if (url.endsWith('/user/register') && method === 'POST') {
			const body = (await req.postDataJSON()) as Record<string, unknown>;
			const name = String(body['name'] || body['username'] || '').trim();
			const email = String(body['email'] || '')
				.trim()
				.toLowerCase();
			const password = String(body['password'] || '');

			// Basic validation similar to backend
			const nameValid = /^[A-Za-z'\-\s]+$/.test(name);
			if (!nameValid) {
				return route.fulfill({
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
			}

			if (users.has(email)) {
				return route.fulfill({
					status: 409,
					contentType: 'application/json',
					body: JSON.stringify({ status: 409, message: 'Email already exists' })
				});
			}

			const id = `mock-${genId()}`;
			const user: User = { id, name, email, password };
			users.set(email, user);

			// create several seeded contacts and conversations so chat tests have data (history + unread)
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
				const unreadCount = ci === 0 ? 2 : 0; // make first conversation have unread messages
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

				// push conversation for both sides
				const listForUser = conversationsByUser.get(id) || [];
				listForUser.push(conversation);
				conversationsByUser.set(id, listForUser);

				const listForContact = conversationsByUser.get(contactId) || [];
				listForContact.push(conversation);
				conversationsByUser.set(contactId, listForContact);

				// create a message history for this conversation (mix of contact and user messages)
				const messages: Message[] = [];
				for (let m = 0; m < MESSAGES_PER_CONV; m++) {
					const minutesAgo = (MESSAGES_PER_CONV - m) * 5; // space messages by 5 minutes
					const ts = new Date(now - minutesAgo * 60 * 1000).toISOString();
					const fromContact = m % 2 === 0; // alternate sender
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

			// Set cookie with user id (simple mock, not a real JWT)
			return route.fulfill({
				status: 200,
				headers: { 'Set-Cookie': `jwt=${id}; Path=/; HttpOnly` },
				contentType: 'application/json',
				body: JSON.stringify({
					status: 200,
					message: 'User registered successfully',
					data: { id, name, email }
				})
			});
		}

		// POST /user/login
		if (url.endsWith('/user/login') && method === 'POST') {
			const body = (await req.postDataJSON()) as Record<string, unknown>;
			const email = String(body['email'] || '')
				.trim()
				.toLowerCase();
			const password = String(body['password'] || '');

			const user = users.get(email);
			if (!user || user.password !== password) {
				return route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ status: 401, message: 'Invalid credentials' })
				});
			}

			return route.fulfill({
				status: 200,
				headers: { 'Set-Cookie': `jwt=${user.id}; Path=/; HttpOnly` },
				contentType: 'application/json',
				body: JSON.stringify({
					status: 200,
					message: 'Login successful',
					data: { id: user.id, name: user.name, email: user.email }
				})
			});
		}

		// GET /user/me
		if (url.endsWith('/user/me') && method === 'GET') {
			const cookies = parseCookie(req.headers()['cookie']);
			const jwt = cookies['jwt'];
			if (!jwt)
				return route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ status: 401, message: 'Unauthorized' })
				});
			// find user by id
			const user = Array.from(users.values()).find((u) => u.id === jwt);
			if (!user)
				return route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ status: 401, message: 'Unauthorized' })
				});
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					status: 200,
					data: { id: user.id, username: user.name, email: user.email }
				})
			});
		}

		// GET /user/search?q=...
		if (url.includes('/user/search') && method === 'GET') {
			const q = new URL(url).searchParams.get('q') || '';
			const results = Array.from(users.values())
				.filter(
					(u) =>
						u.name.toLowerCase().includes(q.toLowerCase()) ||
						u.email.toLowerCase().includes(q.toLowerCase())
				)
				.map((u) => ({ _id: u.id, username: u.name, email: u.email }));
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ status: 200, data: results })
			});
		}

		// Fallback: pass through (for static assets or other hosts)
		return route.continue();
	});

	// route handler for chat endpoints (simple stubs)
	await page.route('**/chat/**', async (route: Route) => {
		const req = route.request();
		const url = req.url();
		const method = req.method().toUpperCase();

		// helper to get current user id from cookie
		const cookies = parseCookie(req.headers()['cookie']);
		const currentUserId = cookies['jwt'] || null;

		// GET /chat/conversations -> return seeded conversations for authenticated user
		if (url.endsWith('/chat/conversations') && method === 'GET') {
			if (!currentUserId)
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ status: 200, data: [] })
				});
			const convs = conversationsByUser.get(currentUserId) || [];
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ status: 200, data: convs })
			});
		}

		// GET /chat/messages/:conversationId or /chat/messages/<otherUserId>
		if (url.match(/\/chat\/messages\//) && method === 'GET') {
			// attempt to extract conversation id (last segment)
			const parts = url.split('/');
			const last = parts[parts.length - 1];
			// if last matches existing conv id
			if (messagesByConversation.has(last)) {
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ status: 200, data: messagesByConversation.get(last) })
				});
			}

			// otherwise try to find conversation between current user and last as other user id
			if (currentUserId) {
				const convs = conversationsByUser.get(currentUserId) || [];
				const conv = convs.find((c: Conversation) => c.participants.includes(last));
				if (conv && messagesByConversation.has(conv._id)) {
					return route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({ status: 200, data: messagesByConversation.get(conv._id) })
					});
				}
			}

			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ status: 200, data: [] })
			});
		}

		// POST /chat/send -> echo message
		if (url.endsWith('/chat/send') && method === 'POST') {
			const body = (await req.postDataJSON()) as Record<string, unknown>;
			// determine conversation: prefer conversationId, else recipient/otherUser
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
				// create a new conversation
				if (!currentUserId || !recipientId) {
					return route.fulfill({
						status: 400,
						contentType: 'application/json',
						body: JSON.stringify({ status: 400, message: 'Missing conversation or recipient' })
					});
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

			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ status: 200, data: message })
			});
		}

		return route.continue();
	});
}

export default setupMockBackend;
