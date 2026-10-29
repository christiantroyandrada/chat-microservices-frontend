// Transaction completion is separate from request success. Aborts discard staged writes.
type IDBReq = {
	result?: unknown;
	onsuccess?: (event: { target: { result: unknown } }) => void;
	onerror?: () => void;
};
export type TransactionControl = {
	autoComplete: boolean;
	abortNext: boolean;
	transactions: Array<{
		oncomplete?: () => void;
		onabort?: () => void;
		onerror?: () => void;
		error?: Error;
		complete: () => void;
		abort: () => void;
	}>;
};

export function emitCursorResults(req: IDBReq, values: unknown[], done = () => {}) {
	let index = 0;
	const next = () => {
		const cursor =
			index < values.length
				? { value: structuredClone(values[index++]), continue: next }
				: undefined;
		req.result = cursor;
		req.onsuccess?.({ target: { result: cursor } });
		if (!cursor) done();
	};
	setTimeout(next, 0);
}

export function makeInMemoryObjectStore() {
	const data = new Map<string, unknown>();
	const control: TransactionControl = { autoComplete: true, abortNext: false, transactions: [] };
	function transaction(_name?: string, mode?: string) {
		const staged = new Map(data);
		let pending = 0;
		let ended = false;
		const done = () => {
			if (--pending) return;
			setTimeout(() => {
				if (control.abortNext) {
					control.abortNext = false;
					tx.abort();
				} else if (control.autoComplete) tx.complete();
			}, 0);
		};
		const request = (operation: () => unknown) => {
			const req: IDBReq = {};
			pending++;
			setTimeout(() => {
				req.result = operation();
				req.onsuccess?.({ target: { result: req.result } });
				done();
			}, 0);
			return req;
		};
		const cursor = (keyPath?: string | string[], range?: unknown) => {
			const req: IDBReq = {};
			pending++;
			const key = (range as { lower?: unknown })?.lower ?? range;
			const keys = Array.isArray(key) ? key : [key];
			const fields = Array.isArray(keyPath) ? keyPath : [keyPath!];
			const values = [...staged.values()].filter(
				(value) =>
					!keyPath ||
					range == null ||
					fields.every((field, index) => (value as Record<string, unknown>)[field] === keys[index])
			);
			emitCursorResults(req, values, done);
			return req;
		};
		const objectStore = {
			put: (value: { _id: string }) => request(() => staged.set(value._id, structuredClone(value))),
			get: (key: string) => request(() => structuredClone(staged.get(key))),
			delete: (key: string) => request(() => staged.delete(key)),
			clear: () => request(() => staged.clear()),
			openCursor: () => cursor(),
			index: (name: string) => ({
				openCursor: (range?: unknown) =>
					cursor(name === 'conversation' ? ['senderId', 'receiverId'] : name, range)
			})
		};
		const tx = {
			objectStore: () => objectStore,
			oncomplete: undefined as (() => void) | undefined,
			onabort: undefined as (() => void) | undefined,
			onerror: undefined as (() => void) | undefined,
			error: undefined as Error | undefined,
			complete() {
				if (ended || pending) return;
				ended = true;
				if (mode !== 'readonly') {
					data.clear();
					for (const [key, value] of staged) data.set(key, value);
				}
				tx.oncomplete?.();
			},
			abort() {
				if (ended) return;
				ended = true;
				tx.error = new Error('Transaction aborted');
				tx.onabort?.();
			}
		};
		control.transactions.push(tx);
		return tx;
	}
	const tx = transaction();
	return { objectStore: tx.objectStore(), tx, transaction, control };
}

function ensureIDBKeyRange() {
	if (typeof globalThis.IDBKeyRange === 'undefined') {
		(globalThis as Record<string, unknown>).IDBKeyRange = {
			only: (value: unknown) => ({
				lower: value,
				upper: value,
				lowerOpen: false,
				upperOpen: false
			}),
			bound: (lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false) => ({
				lower,
				upper,
				lowerOpen,
				upperOpen
			}),
			lowerBound: (lower: unknown, open = false) => ({
				lower,
				upper: undefined,
				lowerOpen: open,
				upperOpen: false
			}),
			upperBound: (upper: unknown, open = false) => ({
				lower: undefined,
				upper,
				lowerOpen: false,
				upperOpen: open
			})
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
	ensureIDBKeyRange();
	const { transaction, control } = makeInMemoryObjectStore();
	vi.spyOn(storeInstance, 'init').mockImplementation(async function (this: { db?: unknown }) {
		this.db = { transaction };
	});
	return control;
}
