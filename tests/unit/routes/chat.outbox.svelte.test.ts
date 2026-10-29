import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Message, User } from '$lib/types';

const mocks = vi.hoisted(() => ({
	conversations: vi.fn(),
	history: vi.fn(),
	prepare: vi.fn(),
	retry: vi.fn(),
	receive: vi.fn(),
	flush: vi.fn(),
	setUser: (_value: User | null) => {},
	incoming: undefined as ((message: Message) => Promise<void>) | undefined,
	status: undefined as ((status: 'connected') => void) | undefined,
	info: vi.fn(),
	error: vi.fn(),
	disconnect: vi.fn(),
	delivered: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_API_URL: 'http://localhost' } }));
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
		prepareMessage: mocks.prepare,
		retryMessage: mocks.retry,
		receiveMessage: mocks.receive,
		flushNotifications: mocks.flush,
		markAsRead: vi.fn().mockResolvedValue(undefined),
		applyReceipt: vi.fn().mockResolvedValue(undefined)
	}
}));
vi.mock('$lib/crypto/signal', () => ({
	initSignalWithRestore: vi.fn().mockResolvedValue(true),
	isSignalInitialized: () => true,
	initSignal: vi.fn(),
	hasSession: vi.fn(),
	createSessionWithPrekeyBundle: vi.fn(),
	encryptMessage: vi.fn(),
	decryptMessage: vi.fn(),
	SignalDecryptionError: class extends Error {}
}));
vi.mock('$lib/services/websocket.service', () => ({
	wsService: {
		connect: vi.fn(),
		disconnect: mocks.disconnect,
		isConnected: () => false,
		onMessage: (callback: typeof mocks.incoming) => {
			mocks.incoming = callback;
			return () => {};
		},
		onStatusChange: (callback: typeof mocks.status) => {
			mocks.status = callback;
			return () => {};
		},
		onTyping: () => () => {},
		onPresence: () => () => {},
		onReceipt: () => () => {},
		sendTyping: vi.fn(),
		sendDelivered: mocks.delivered,
		sendMarkRead: vi.fn()
	}
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

describe('chat durable send UI', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.setUser(alice);
		mocks.conversations.mockResolvedValue([
			{ userId: 'bob', username: 'Bob', unreadCount: 0 },
			{ userId: 'carol', username: 'Carol', unreadCount: 0 }
		]);
		mocks.history.mockResolvedValue([]);
		mocks.flush.mockResolvedValue(undefined);
		mocks.prepare.mockResolvedValue(pending);
		mocks.retry.mockResolvedValue({ ...pending, sendState: 'failed', sendError: 'Try again.' });
	});
	afterEach(cleanup);
	async function openBob() {
		const rendered = render(ChatPage);
		await waitFor(() =>
			expect(rendered.container.querySelectorAll('.conversation-button')).toHaveLength(2)
		);
		await fireEvent.click(rendered.getByText('Bob'));
		await waitFor(() => expect(rendered.queryByLabelText('Message input')).toBeTruthy());
		return rendered;
	}

	it('sends while socket is disconnected and shows accessible pending, failure, retry, and receipt states', async () => {
		const request = deferred<Message>();
		mocks.retry.mockReturnValueOnce(request.promise);
		const view = await openBob();
		const input = view.getByLabelText('Message input') as HTMLTextAreaElement;
		await fireEvent.input(input, { target: { value: 'durable text' } });
		await fireEvent.click(view.getByLabelText('Seal and send message'));
		await waitFor(() => expect(view.getByRole('status').textContent).toBe('Pending'));
		expect(input.value).toBe('');
		request.resolve({ ...pending, sendState: 'failed', sendError: 'Try again.' });
		await waitFor(() => expect(view.getByRole('status').textContent).toBe('Failed'));
		mocks.retry.mockResolvedValueOnce({
			...pending,
			_id: 'server-id',
			sendState: 'accepted',
			retryable: false,
			status: 'delivered'
		});
		await fireEvent.click(view.getByRole('button', { name: 'Retry message' }));
		await waitFor(() => expect(view.getByLabelText('Delivered')).toBeTruthy());
		expect(view.container.querySelectorAll('.message-row')).toHaveLength(1);
		expect(mocks.prepare).toHaveBeenCalledTimes(1);
		expect(mocks.retry).toHaveBeenCalledTimes(2);
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
		await waitFor(() => expect(view.getByText('Carol')).toBeTruthy());
		expect(view.queryByText('durable text')).toBeNull();
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
		await mocks.incoming!(message);
		await mocks.incoming!(message);
		await waitFor(() =>
			expect(view.container.querySelector('.unread-badge')?.textContent?.trim()).toBe('1')
		);
		expect(mocks.info).toHaveBeenCalledTimes(1);
		expect(mocks.delivered).toHaveBeenCalledTimes(2);
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
		await waitFor(() => expect(view.getByText('Carol')).toBeTruthy());
		expect(view.queryByText('durable text')).toBeNull();
	});

	it('drops incoming completion after logout', async () => {
		const request = deferred<{ message: Message; fresh: boolean }>();
		mocks.receive.mockReturnValue(request.promise);
		const view = await openBob();
		const receive = mocks.incoming!({ ...pending, senderId: 'bob', receiverId: 'alice' });
		mocks.setUser(null);
		request.resolve({ message: { ...pending, senderId: 'bob', receiverId: 'alice' }, fresh: true });
		await receive;
		expect(mocks.info).not.toHaveBeenCalled();
		expect(view.queryByText('durable text')).toBeNull();
	});

	it('announces a duplicate incoming message once and flushes only the active owner on reconnect', async () => {
		const message = { ...pending, senderId: 'bob', receiverId: 'alice' };
		mocks.receive
			.mockResolvedValueOnce({ message, fresh: true })
			.mockResolvedValueOnce({ message, fresh: false });
		const view = await openBob();
		await mocks.incoming!(message);
		await mocks.incoming!(message);
		await waitFor(() => expect(view.queryAllByText('durable text')).toHaveLength(1));
		expect(mocks.info).toHaveBeenCalledTimes(1);
		mocks.status!('connected');
		expect(mocks.flush).toHaveBeenLastCalledWith('alice');
	});

	it('appends a newly decrypted live message when its conversation becomes active', async () => {
		const request = deferred<{ message: Message; fresh: boolean }>();
		mocks.receive.mockReturnValue(request.promise);
		const view = render(ChatPage);
		await waitFor(() => expect(view.getByText('Bob')).toBeTruthy());
		const message = { ...pending, senderId: 'bob', receiverId: 'alice' };
		const receiving = mocks.incoming!(message);
		await fireEvent.click(view.getByText('Bob'));
		request.resolve({ message, fresh: true });
		await receiving;
		await waitFor(() => expect(view.getByText('durable text')).toBeTruthy());
	});
});
