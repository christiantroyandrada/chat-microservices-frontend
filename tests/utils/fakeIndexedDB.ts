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

/**
 * Create a fake IDB index that filters data based on keyPath(s).
 * Supports compound indexes (array of field names) used by the 'conversation' index.
 * When openCursor is called with an IDBKeyRange.only([...]) equivalent object,
 * it filters records matching all fields in the key array.
 */
function makeInMemoryIndex(data: Map<string, unknown>, keyPath: string | string[]) {
	return {
		openCursor(range?: unknown) {
			const req: IDBReq = {};
			setTimeout(() => {
				const values = Array.from(data.values()) as Record<string, unknown>[];

				let filtered: unknown[];
				if (range !== undefined && range !== null) {
					// IDBKeyRange.only produces { lower, upper, lowerOpen: false, upperOpen: false }
					// where lower === upper === the key value passed to IDBKeyRange.only()
					const rangeObj = range as { lower?: unknown };
					const keyValue = rangeObj.lower !== undefined ? rangeObj.lower : range;
					const keyArr = Array.isArray(keyValue) ? keyValue : [keyValue];

					if (Array.isArray(keyPath)) {
						filtered = values.filter((record) =>
							keyPath.every((field, i) => record[field] === keyArr[i])
						);
					} else {
						filtered = values.filter((record) => record[keyPath] === keyArr[0]);
					}
				} else {
					filtered = values;
				}

				emitCursorResults(req, filtered);
			}, 0);
			return req;
		}
	};
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
		},
		/**
		 * Fake IDB index() — returns an in-memory index that filters records using the
		 * compound 'conversation' index (['senderId', 'receiverId']) added in messageStore.ts.
		 */
		index(indexName: string) {
			const indexMap: Record<string, string | string[]> = {
				conversation: ['senderId', 'receiverId'],
				timestamp: 'timestamp'
			};
			const keyPath = indexMap[indexName] ?? indexName;
			return makeInMemoryIndex(data, keyPath);
		}
	};

	const tx = { objectStore: () => objectStore };

	return { objectStore, tx };
}

/**
 * Polyfill IDBKeyRange for the Node/server test environment.
 * IDBKeyRange.only(value) returns { lower: value, upper: value, ... }.
 * This is the only IDBKeyRange method used in messageStore.ts.
 */
function ensureIDBKeyRange() {
	if (typeof globalThis.IDBKeyRange === 'undefined') {
		(globalThis as Record<string, unknown>).IDBKeyRange = {
			only(value: unknown) {
				return { lower: value, upper: value, lowerOpen: false, upperOpen: false };
			},
			bound(lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false) {
				return { lower, upper, lowerOpen, upperOpen };
			},
			lowerBound(lower: unknown, open = false) {
				return { lower, upper: undefined, lowerOpen: open, upperOpen: false };
			},
			upperBound(upper: unknown, open = false) {
				return { lower: undefined, upper, lowerOpen: false, upperOpen: open };
			}
		};
	}
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
	// Ensure IDBKeyRange is available in the Node test environment
	ensureIDBKeyRange();

	const { tx } = makeInMemoryObjectStore();
	vi.spyOn(storeInstance, 'init').mockImplementation(async function (this: { db?: unknown }) {
		this.db = { transaction: () => tx };
	});
	return tx;
}
