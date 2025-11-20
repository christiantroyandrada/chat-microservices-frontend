// Lightweight in-memory fake object store utilities for tests
export function emitCursorResults(req: any, values: any[]) {
	let idx = 0;
	const next = () => {
		if (idx < values.length) {
			const cursor = { value: values[idx++], continue: next };
			if (req.onsuccess) req.onsuccess({ target: { result: cursor } });
			return;
		}
		if (req.onsuccess) req.onsuccess({ target: { result: undefined } });
	};
	setTimeout(next, 0);
}

export function makeInMemoryObjectStore() {
	const data = new Map<string, any>();

	const objectStore: any = {
		put(value: any) {
			const req: any = {};
			setTimeout(() => {
				data.set(value._id, value);
				if (req.onsuccess) req.onsuccess({});
			}, 0);
			return req;
		},
		get(key: string) {
			const req: any = {};
			setTimeout(() => {
				if (req.onsuccess) req.onsuccess({ target: { result: data.get(key) } });
			}, 0);
			return req;
		},
		openCursor() {
			const req: any = {};
			setTimeout(() => {
				const values = Array.from(data.values());
				emitCursorResults(req, values);
			}, 0);
			return req;
		},
		delete(key: string) {
			const req: any = {};
			setTimeout(() => {
				data.delete(key);
				if (req.onsuccess) req.onsuccess({});
			}, 0);
			return req;
		},
		clear() {
			const req: any = {};
			setTimeout(() => {
				data.clear();
				if (req.onsuccess) req.onsuccess({});
			}, 0);
			return req;
		}
	};

	const tx = { objectStore: () => objectStore };

	return { objectStore, tx };
}

export function attachFakeStoreTo(storeInstance: any, vi: any) {
	const { tx } = makeInMemoryObjectStore();
	vi.spyOn(storeInstance as any, 'init').mockImplementation(async function (this: any) {
		this.db = { transaction: () => tx };
	});
	return tx;
}
