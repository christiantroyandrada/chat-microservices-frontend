import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type FetchFixture = {
	request: Request;
	respondWith(response: Promise<Response>): void;
	waitUntil(promise: Promise<unknown>): void;
};

describe('service-worker cache writes', () => {
	let fetchListener: (event: FetchFixture) => void;
	let cache: { match: Mock<() => Promise<Response | undefined>>; put: Mock<() => Promise<void>> };
	beforeEach(async () => {
		vi.resetModules();
		fetchListener = () => {
			throw new Error('missing fetch listener');
		};
		vi.stubGlobal('self', {
			location: { origin: 'https://chat.test' },
			addEventListener(type: string, listener: typeof fetchListener) {
				if (type === 'fetch') fetchListener = listener;
			}
		});
		cache = {
			match: vi.fn(async (): Promise<Response | undefined> => undefined),
			put: vi.fn(async () => {})
		};
		vi.stubGlobal('caches', { match: cache.match, open: async () => cache });
		vi.stubGlobal('fetch', async () => new Response('fresh response'));
		await import(new URL('../../src/service-worker.ts', import.meta.url).href);
	});
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		['precache', '/app.js', 'cors', 'open'],
		['precache', '/app.js', 'cors', 'match'],
		['navigation', '/page', 'navigate', 'open'],
		['navigation', '/page', 'navigate', 'match'],
		['revalidation', '/avatar.png', 'cors', 'open'],
		['revalidation', '/avatar.png', 'cors', 'match']
	])('recovers when %s (%s, %s) cache %s fails', async (_strategy, path, mode, operation) => {
		const failure = new Error('cache unavailable');
		const offline = mode === 'navigate' && operation === 'match';
		if (offline) vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		if (operation === 'match') cache.match.mockRejectedValue(failure);
		vi.stubGlobal('caches', {
			match: cache.match,
			open: operation === 'open' ? vi.fn().mockRejectedValue(failure) : async () => cache
		});
		const request = new Request(`https://chat.test${path}`);
		Object.defineProperty(request, 'mode', { value: mode });
		let response: Promise<Response> | undefined;
		fetchListener({
			request,
			respondWith(value) {
				response = value;
			},
			waitUntil() {}
		});
		const result = await response!;
		expect(result.status).toBe(offline ? 503 : 200);
		expect(await result.text()).toBe(
			offline ? 'Offline — please check your connection' : 'fresh response'
		);
		if (operation === 'match') expect(cache.match).toHaveBeenCalledOnce();
	});

	it.each([
		['precache', '/app.js', 'cors'],
		['navigation', '/page', 'navigate'],
		['revalidation', '/avatar.png', 'cors']
	])(
		'finishes %s cache work without losing the network response on quota failure',
		async (_strategy, path, mode) => {
			let completeWrite: () => void = () => {};
			let failWrite: () => void = () => {};
			cache.put.mockImplementation(
				() =>
					new Promise<void>((resolve, reject) => {
						completeWrite = resolve;
						failWrite = () => reject(new Error('quota exceeded'));
					})
			);
			const request = new Request(`https://chat.test${path}`);
			Object.defineProperty(request, 'mode', { value: mode });
			let response: Promise<Response> | undefined;
			fetchListener({
				request,
				respondWith(value) {
					response = value;
				},
				waitUntil() {}
			});
			expect(response).toBeDefined();
			let settled = false;
			void response!.then(() => {
				settled = true;
			});
			try {
				await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
				expect(settled).toBe(false);
				failWrite();
				expect(await (await response!).text()).toBe('fresh response');
			} finally {
				completeWrite();
			}
		}
	);

	it('keeps cached-response revalidation alive until its cache write settles', async () => {
		cache.match.mockResolvedValue(new Response('cached response'));
		let finish: () => void = () => {};
		cache.put.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		let response: Promise<Response> | undefined;
		let background: Promise<unknown> | undefined;
		fetchListener({
			request: new Request('https://chat.test/avatar.png'),
			respondWith(value) {
				response = value;
			},
			waitUntil(value) {
				background = value;
			}
		});
		try {
			expect(await (await response!).text()).toBe('cached response');
			expect(background).toBeDefined();
			let settled = false;
			void background!.then(() => {
				settled = true;
			});
			await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
			expect(settled).toBe(false);
			finish();
			await background;
			expect(settled).toBe(true);
		} finally {
			finish();
		}
	});
});
