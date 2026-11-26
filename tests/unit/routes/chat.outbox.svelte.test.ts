import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import type { Message, User } from '$lib/types';

const mocks = vi.hoisted(() => ({
	conversations: vi.fn(),
	history: vi.fn(),
	historyPage: vi.fn(),
	markAsRead: vi.fn().mockResolvedValue(undefined),
	prepare: vi.fn(),
	retry: vi.fn(),
	receive: vi.fn(),
	flush: vi.fn(),
	setUser: (_value: User | null) => {},
	info: vi.fn(),
	error: vi.fn(),
	acknowledgeDelivery: vi.fn().mockResolvedValue(undefined),
	env: { PUBLIC_API_URL: 'http://localhost' }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: mocks.env }));
vi.mock('$lib/stores/auth.store', async () => {
	const { writable } = await import('svelte/store');
	const user = writable<User | null>(null);
	mocks.setUser = (value) => user.set(value);
	return {
		user,
		authStore: { init: vi.fn().mockResolvedValue(undefined), logout: vi.fn(() => user.set(null)) }
	};
});
vi.mock('$lib/services/chat.service', () => ({
	chatService: {
		getConversations: mocks.conversations,
		getMessages: mocks.history,
		getMessagesPage: mocks.historyPage,
		prepareMessage: mocks.prepare,
		retryMessage: mocks.retry,
		receiveMessage: mocks.receive,
		flushNotifications: mocks.flush,
		markAsRead: mocks.markAsRead,
		acknowledgeDelivery: mocks.acknowledgeDelivery
	}
}));
vi.mock('$lib/crypto/signal', () => ({
	hasLocalKeys: vi.fn().mockResolvedValue(true),
	initSignalWithRestore: vi.fn().mockResolvedValue(true),
	isSignalInitialized: () => true,
	initSignal: vi.fn(),
	hasSession: vi.fn(),
	createSessionWithPrekeyBundle: vi.fn(),
	encryptMessage: vi.fn(),
	decryptMessage: vi.fn(),
	SignalDecryptionError: class extends Error {}
}));
vi.mock('$lib/stores/toast.store', () => ({
	toastStore: { info: mocks.info, error: mocks.error, success: vi.fn(), warning: vi.fn() }
}));
vi.mock('$lib/stores/notification.store', async () => {
	const { writable } = await import('svelte/store');
	return {
		notificationStore: {
			...writable({ notifications: [], unreadCount: 0 }),
			fetch: vi.fn().mockResolvedValue(undefined)
		}
	};
});
import ChatPage from '../../../src/routes/chat/+page.svelte';

const alice: User = { _id: 'alice', username: 'Alice', email: 'alice@example.com' };
const pending: Message = {
	_id: 'client-id',
	clientMessageId: 'client-id',
	senderId: 'alice',
	receiverId: 'bob',
	content: 'durable text',
	timestamp: new Date().toISOString(),
	sendState: 'pending',
	retryable: true
};
const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

const sockets: FakeSocket[] = [];
class FakeSocket extends EventTarget {
	static readonly OPEN = 1;
	readonly readyState = FakeSocket.OPEN;
	readonly send = vi.fn<(data: string) => void>();
	constructor(readonly url: URL) {
		super();
		sockets.push(this);
	}
	close() {
		this.dispatchEvent(new Event('close'));
	}
	frame(data: object) {
		this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
	}
}

describe('chat durable send UI', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sockets.length = 0;
		vi.stubGlobal('WebSocket', FakeSocket);
		mocks.setUser(alice);
		mocks.conversations.mockResolvedValue([
			{ userId: 'bob', username: 'Bob', unreadCount: 0 },
			{ userId: 'carol', username: 'Carol', unreadCount: 0 }
		]);
		mocks.history.mockResolvedValue([]);
		mocks.historyPage.mockReset();
		mocks.historyPage.mockImplementation(
			async (peer: string, limit: number, offset: number, owner: string) => {
				const messages = (await mocks.history(peer, limit, offset, owner)) as Message[];
				return {
					messages,
					firstId: messages[0]?._id,
					lastId: messages.at(-1)?._id,
					hasMore: false
				};
			}
		);
		mocks.flush.mockResolvedValue(undefined);
		mocks.prepare.mockResolvedValue(pending);
		mocks.retry.mockResolvedValue({ ...pending, sendState: 'failed', sendError: 'Try again.' });
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});
	async function openBob(ready = false) {
		const rendered = render(ChatPage);
		await waitFor(() =>
			expect(rendered.container.querySelectorAll('.conversation-button')).toHaveLength(2)
		);
		if (ready) sockets[0].frame({ type: 'ready' });
		await fireEvent.click(rendered.getByText('Bob'));
		await waitFor(() => expect(rendered.queryByLabelText('Message input')).toBeTruthy());
		return rendered;
	}

	it('drains cursor pages after reconnect without replacing the last synced anchor with live events', async () => {
		const stored = (i: number): Message => ({
			_id: 'message-' + i,
			senderId: i === 61 ? 'bob' : 'alice',
			receiverId: i === 61 ? 'alice' : 'bob',
			content: 'Message ' + i,
			timestamp: new Date(2026, 0, 1, 0, i).toISOString()
		});
		mocks.history.mockResolvedValue([stored(0)]);
		mocks.historyPage.mockImplementation(async (_peer, _limit, _offset, _owner, cursor) => {
			const page =
				cursor?.afterMessageId === 'message-0'
					? Array.from({ length: 50 }, (_, i) => stored(i + 1))
					: cursor?.afterMessageId === 'message-50'
						? Array.from({ length: 11 }, (_, i) => stored(i + 51))
						: [stored(0)];
			return {
				messages: page,
				firstId: page[0]._id,
				lastId: page.at(-1)!._id,
				hasMore: page.length === 50
			};
		});
		const rendered = await openBob(true);
		await waitFor(() => expect(rendered.getByText('Message 0')).toBeTruthy());
		const initialSocket = sockets[0];
		initialSocket.close();
		await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
		const reconnected = sockets[1];
		const firstPage = deferred<{
			messages: Message[];
			firstId: string;
			lastId: string;
			hasMore: boolean;
		}>();
		// Let the live event arrive before the reconnect query returns.
		mocks.historyPage.mockImplementationOnce(() => firstPage.promise);
		mocks.receive.mockResolvedValue({ message: stored(61), fresh: true });
		reconnected.frame({ type: 'ready' });
		reconnected.frame({
			type: 'message',
			data: {
				id: 'message-61',
				senderId: 'bob',
				receiverId: 'alice',
				message: 'ciphertext',
				createdAt: stored(61).timestamp,
				status: 'NotDelivered'
			}
		});
		const thread = within(rendered.getByRole('region', { name: 'Conversation thread' }));
		expect(await thread.findByText('Message 61')).toBeTruthy();
		expect(mocks.historyPage).toHaveBeenCalledWith('bob', 50, 0, 'alice', {
			afterMessageId: 'message-0'
		});
		firstPage.resolve({
			messages: Array.from({ length: 50 }, (_, i) => stored(i + 1)),
			firstId: 'message-1',
			lastId: 'message-50',
			hasMore: true
		});
		await waitFor(() => expect(rendered.getAllByText(/^Message \d+$/)).toHaveLength(62));
		expect(mocks.historyPage).toHaveBeenCalledWith('bob', 50, 0, 'alice', {
			afterMessageId: 'message-50'
		});
	});

	it('acknowledges only visible inbound rows', async () => {
		const callbacks = new Map<Element, IntersectionObserverCallback>();
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(private readonly callback: IntersectionObserverCallback) {}
				observe(element: Element) {
					callbacks.set(element, this.callback);
				}
				disconnect() {
					callbacks.clear();
				}
			}
		);
		const incoming = {
			...pending,
			senderId: 'bob',
			receiverId: 'alice',
			sendState: undefined,
			retryable: undefined
		};
		mocks.history.mockResolvedValue([
			{ ...incoming, _id: 'above', content: 'Above viewport' },
			{ ...incoming, _id: 'visible', content: 'Visible message' }
		]);
		const rendered = await openBob();
		const row = (await rendered.findByText('Visible message')).closest('[data-unread-message]')!;
		await waitFor(() => expect(callbacks.has(row)).toBe(true));
		expect(mocks.markAsRead).not.toHaveBeenCalled();
		callbacks.get(row)?.(
			[
				{
					target: row,
					isIntersecting: true,
					intersectionRect: { height: 24 }
				} as IntersectionObserverEntry
			],
			{} as IntersectionObserver
		);
		await waitFor(() => expect(mocks.markAsRead).toHaveBeenCalledWith('bob', 'alice', ['visible']));
		expect(mocks.markAsRead).toHaveBeenCalledTimes(1);
	});

	it('sends while socket is disconnected and shows accessible pending, failure, retry, and receipt states', async () => {
		const request = deferred<Message>();
		mocks.retry.mockReturnValueOnce(request.promise);
		const view = await openBob();
		const input = view.getByLabelText('Message input') as HTMLTextAreaElement;
		await fireEvent.input(input, { target: { value: 'durable text' } });
		await fireEvent.click(view.getByLabelText('Seal and send message'));
		const thread = within(view.getByRole('region', { name: 'Conversation thread' }));
		await waitFor(() => expect(thread.getByRole('status').textContent).toBe('Pending'));
		expect(input.value).toBe('');
		request.resolve({ ...pending, sendState: 'failed', sendError: 'Try again.' });
		await waitFor(() => expect(thread.getByRole('status').textContent).toBe('Failed'));
		mocks.retry.mockResolvedValueOnce({
			...pending,
			_id: 'server-id',
			sendState: 'accepted',
			status: 'sent',
			retryable: false
		});
		await fireEvent.click(view.getByRole('button', { name: 'Retry message' }));
		await waitFor(() => expect(view.getByLabelText('Sent')).toBeTruthy());
		expect(view.container.querySelectorAll('.message-row')).toHaveLength(1);
		expect(mocks.prepare).toHaveBeenCalledTimes(1);
		expect(mocks.retry).toHaveBeenCalledTimes(2);
		const accepted: Message = { ...pending, _id: 'server-id', sendState: 'accepted' };
		mocks.history.mockResolvedValue([{ ...accepted, status: 'delivered' }]);
		sockets[0].frame({ type: 'ready' });
		await waitFor(() => expect(view.getByLabelText('Delivered')).toBeTruthy());
		mocks.history.mockResolvedValue([{ ...accepted, status: 'read', read: true }]);
		sockets[0].frame({ type: 'receipt', data: { type: 'read', userId: 'alice', by: 'bob' } });
		await waitFor(() => expect(view.getByLabelText('Read')).toBeTruthy());
	});

	it('opens native Go and sends typing with no mode flag', async () => {
		sockets.length = 0;
		vi.stubGlobal('WebSocket', FakeSocket);
		const view = await openBob();
		expect(sockets).toHaveLength(1);
		sockets[0].frame({ type: 'ready' });
		await fireEvent.input(view.getByLabelText('Message input'), {
			target: { value: 'A Go-only draft' }
		});
		await waitFor(() =>
			expect(sockets[0].send).toHaveBeenCalledWith(
				JSON.stringify({ type: 'typing', receiverId: 'bob', isTyping: true })
			)
		);
	});

	it('retries failed legacy cleanup on Go readiness without blocking history', async () => {
		sockets.length = 0;
		vi.stubGlobal('WebSocket', FakeSocket);
		let pendingLegacy = true;
		mocks.flush
			.mockRejectedValueOnce(new Error('Initial IndexedDB abort'))
			.mockRejectedValueOnce(new Error('Ready IndexedDB abort'))
			.mockImplementation(async () => {
				pendingLegacy = false;
			});
		const view = await openBob();
		expect(mocks.flush).toHaveBeenCalledTimes(1);
		sockets[0].frame({ type: 'ready' });
		await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(2));
		expect(pendingLegacy).toBe(true);
		const missed = { ...pending, _id: 'missed', content: 'recovered history' };
		mocks.history.mockResolvedValue([missed]);
		sockets[0].close();
		await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2500 });
		sockets[1].frame({ type: 'ready' });
		await waitFor(() => expect(pendingLegacy).toBe(false));
		await waitFor(() => expect(view.getByText('recovered history')).toBeTruthy());
		expect(mocks.prepare).not.toHaveBeenCalled();
		expect(mocks.retry).not.toHaveBeenCalled();
	});

	it('uses Go for inbound messages and refreshes the active thread after reconnect', async () => {
		sockets.length = 0;
		vi.stubGlobal('WebSocket', FakeSocket);
		const view = await openBob();
		expect(sockets).toHaveLength(1);
		expect(sockets[0].url.searchParams.get('expectedUserId')).toBe('alice');
		sockets[0].frame({ type: 'ready' });
		await waitFor(() =>
			expect(sockets[0].send).toHaveBeenCalledWith(
				JSON.stringify({ type: 'watchPresence', userId: 'bob' })
			)
		);
		sockets[0].frame({ type: 'presence', data: { userId: 'carol', online: true } });
		expect(view.getByText('Presence unavailable')).toBeTruthy();
		sockets[0].frame({ type: 'presence', data: { userId: 'bob', online: false } });
		await waitFor(() => expect(view.getByText('Offline', { exact: true })).toBeTruthy());

		const live = { ...pending, _id: 'live', senderId: 'bob', receiverId: 'alice' };
		mocks.receive.mockResolvedValue({ message: live, fresh: true });

		const wire = {
			id: live._id,
			senderId: 'bob',
			receiverId: 'alice',
			message: 'ciphertext',
			status: 'NotDelivered'
		};
		sockets[0].frame({ type: 'message', data: { ...wire, receiverId: 'carol' } });
		sockets[0].frame({ type: 'message', data: wire });
		await waitFor(() => expect(mocks.receive).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(view.getByText('durable text')).toBeTruthy());
		expect(mocks.acknowledgeDelivery).toHaveBeenCalledWith('live', 'alice');

		const missed = { ...live, _id: 'missed', clientMessageId: 'missed', content: 'missed text' };
		mocks.history.mockResolvedValue([live, missed]);
		sockets[0].close();
		await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2500 });
		expect(view.getByText('Presence unavailable')).toBeTruthy();
		sockets[1].frame({ type: 'ready' });
		expect(sockets[1].send).toHaveBeenCalledWith(
			JSON.stringify({ type: 'watchPresence', userId: 'bob' })
		);
		await waitFor(() => expect(view.getByText('missed text')).toBeTruthy());
		expect(view.getAllByText('durable text')).toHaveLength(1);
	});

	it('keeps a late send result out of the next conversation', async () => {
		const request = deferred<Message>();
		mocks.retry.mockReturnValueOnce(request.promise);
		const view = await openBob();
		await fireEvent.input(view.getByLabelText('Message input'), {
			target: { value: 'durable text' }
		});
		await fireEvent.click(view.getByLabelText('Seal and send message'));
		await waitFor(() => expect(mocks.retry).toHaveBeenCalled());
		await fireEvent.click(view.getByLabelText('Back to conversations'));
		await fireEvent.click(view.getByText('Carol'));
		request.resolve({ ...pending, _id: 'server-id', sendState: 'accepted' });
		await request.promise;
		const thread = within(view.getByRole('region', { name: 'Conversation thread' }));
		expect(thread.getByRole('heading', { name: 'Carol' })).toBeTruthy();
		expect(thread.queryByText('durable text')).toBeNull();
	});
	it('preserves a draft when durable preparation fails', async () => {
		mocks.prepare.mockRejectedValueOnce(new Error('Storage unavailable'));
		const view = await openBob();
		const input = view.getByLabelText('Message input') as HTMLTextAreaElement;
		await fireEvent.input(input, { target: { value: 'keep this draft' } });
		await fireEvent.click(view.getByLabelText('Seal and send message'));
		await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Storage unavailable'));
		expect(input.value).toBe('keep this draft');
		expect(mocks.retry).not.toHaveBeenCalled();
	});
	it('increments unread once for repeated background delivery', async () => {
		const message = { ...pending, senderId: 'bob', receiverId: 'alice' };
		mocks.receive
			.mockResolvedValueOnce({ message, fresh: true })
			.mockResolvedValueOnce({ message, fresh: false });
		const view = render(ChatPage);
		await waitFor(() => expect(view.getByText('Bob')).toBeTruthy());
		sockets[0].frame({ type: 'ready' });
		sockets[0].frame({
			type: 'message',
			data: {
				id: message._id,
				senderId: message.senderId,
				receiverId: message.receiverId,
				message: 'ciphertext',
				status: 'NotDelivered'
			}
		});
		await waitFor(() => expect(mocks.receive).toHaveBeenCalled());
		sockets[0].frame({
			type: 'message',
			data: {
				id: message._id,
				senderId: message.senderId,
				receiverId: message.receiverId,
				message: 'ciphertext',
				status: 'NotDelivered'
			}
		});
		await waitFor(() => expect(mocks.receive).toHaveBeenCalled());
		await waitFor(() =>
			expect(view.container.querySelector('.unread-badge')?.textContent?.trim()).toBe('1')
		);
		expect(mocks.info).toHaveBeenCalledTimes(1);
		expect(mocks.acknowledgeDelivery).toHaveBeenCalledTimes(2);
	});

	it('keeps a late history result out of the next conversation', async () => {
		const history = deferred<Message[]>();
		mocks.history.mockImplementation((_recipient, limit) =>
			limit === 1 ? Promise.resolve([]) : history.promise
		);
		const view = await openBob();
		await fireEvent.click(view.getByLabelText('Back to conversations'));
		mocks.history.mockResolvedValue([]);
		await fireEvent.click(view.getByText('Carol'));
		history.resolve([pending]);
		await history.promise;
		const thread = within(view.getByRole('region', { name: 'Conversation thread' }));
		expect(thread.getByRole('heading', { name: 'Carol' })).toBeTruthy();
		expect(thread.queryByText('durable text')).toBeNull();
	});

	it('drops incoming completion after logout', async () => {
		const request = deferred<{ message: Message; fresh: boolean }>();
		mocks.receive.mockReturnValue(request.promise);
		const view = await openBob();
		sockets[0].frame({ type: 'ready' });
		sockets[0].frame({
			type: 'message',
			data: {
				id: pending._id,
				senderId: 'bob',
				receiverId: 'alice',
				message: 'ciphertext',
				status: 'NotDelivered'
			}
		});
		await waitFor(() => expect(mocks.receive).toHaveBeenCalled());
		mocks.setUser(null);
		request.resolve({ message: { ...pending, senderId: 'bob', receiverId: 'alice' }, fresh: true });
		await request.promise;
		expect(mocks.info).not.toHaveBeenCalled();
		expect(view.queryByText('durable text')).toBeNull();
	});

	it('announces a duplicate incoming message once and flushes only the active owner on reconnect', async () => {
		const message = { ...pending, senderId: 'bob', receiverId: 'alice' };
		mocks.receive
			.mockResolvedValueOnce({ message, fresh: true })
			.mockResolvedValueOnce({ message, fresh: false });
		const view = await openBob();
		sockets[0].frame({ type: 'ready' });
		sockets[0].frame({
			type: 'message',
			data: {
				id: message._id,
				senderId: message.senderId,
				receiverId: message.receiverId,
				message: 'ciphertext',
				status: 'NotDelivered'
			}
		});
		await waitFor(() => expect(mocks.receive).toHaveBeenCalled());
		sockets[0].frame({
			type: 'message',
			data: {
				id: message._id,
				senderId: message.senderId,
				receiverId: message.receiverId,
				message: 'ciphertext',
				status: 'NotDelivered'
			}
		});
		await waitFor(() => expect(mocks.receive).toHaveBeenCalled());
		await waitFor(() => expect(view.queryAllByText('durable text')).toHaveLength(1));
		expect(mocks.info).toHaveBeenCalledTimes(1);
		sockets[0].frame({ type: 'ready' });
		expect(mocks.flush).toHaveBeenLastCalledWith('alice');
	});

	it('appends a newly decrypted live message when its conversation becomes active', async () => {
		const request = deferred<{ message: Message; fresh: boolean }>();
		mocks.receive.mockReturnValue(request.promise);
		const view = render(ChatPage);
		await waitFor(() => expect(view.getByText('Bob')).toBeTruthy());
		sockets[0].frame({ type: 'ready' });
		const message = { ...pending, senderId: 'bob', receiverId: 'alice' };
		sockets[0].frame({
			type: 'message',
			data: {
				id: message._id,
				senderId: message.senderId,
				receiverId: message.receiverId,
				message: 'ciphertext',
				status: 'NotDelivered'
			}
		});
		await waitFor(() => expect(mocks.receive).toHaveBeenCalled());
		await fireEvent.click(await view.findByRole('button', { name: 'Chat with Bob' }));
		request.resolve({ message, fresh: true });
		await request.promise;
		await waitFor(() => expect(view.getByText('durable text')).toBeTruthy());
	});
});
