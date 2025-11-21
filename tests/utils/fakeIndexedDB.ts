// Lightweight in-memory fake object store utilities for tests
type IDBReq = { onsuccess?: (ev: { target: { result: unknown } }) => void };

export function emitCursorResults(req: IDBReq, values: unknown[]) {
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
	const data = new Map<string, unknown>();

	const objectStore = {
		put(value: { _id: string; [k: string]: unknown }) {
			const req: IDBReq = {};
			setTimeout(() => {
				data.set(value._id, value);
				if (req.onsuccess) req.onsuccess({ target: { result: {} } });
			}, 0);
			return req;
		},
		get(key: string) {
			const req: IDBReq = {};
			setTimeout(() => {
				if (req.onsuccess) req.onsuccess({ target: { result: data.get(key) } });
			}, 0);
			return req;
		},
		openCursor() {
			const req: IDBReq = {};
			setTimeout(() => {
				const values = Array.from(data.values());
				emitCursorResults(req, values);
			}, 0);
			return req;
		},
		delete(key: string) {
			const req: IDBReq = {};
			setTimeout(() => {
				data.delete(key);
				if (req.onsuccess) req.onsuccess({ target: { result: {} } });
			}, 0);
			return req;
		},
		clear() {
			const req: IDBReq = {};
			setTimeout(() => {
				data.clear();
				if (req.onsuccess) req.onsuccess({ target: { result: {} } });
			}, 0);
			return req;
		}
	};

	const tx = { objectStore: () => objectStore };

	return { objectStore, tx };
}

export function attachFakeStoreTo(
	storeInstance: { init: (...args: unknown[]) => unknown },
	vi: {
		spyOn: (
			obj: unknown,
			prop: string
		) => { mockImplementation: (fn: (...args: unknown[]) => unknown) => void };
	}
) {
	const { tx } = makeInMemoryObjectStore();
	vi.spyOn(storeInstance, 'init').mockImplementation(async function (this: { db?: unknown }) {
		this.db = { transaction: () => tx };
	});
	return tx;
}
