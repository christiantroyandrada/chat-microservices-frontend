// Safely read environment variables in both Node and browser/Vite contexts.
// `process` may be undefined in the browser, so guard access. Vite exposes
// env vars on `import.meta.env` which we also use as a fallback.
const _importMetaEnv =
	typeof import.meta === 'object'
		? (import.meta as unknown as { env?: Record<string, unknown> }).env
		: undefined;

const _env =
	(typeof process !== 'undefined' && process?.env?.NODE_ENV) ||
	(_importMetaEnv && ((_importMetaEnv.MODE as string) || (_importMetaEnv.NODE_ENV as string))) ||
	undefined;
const _vitest =
	(typeof process !== 'undefined' && process?.env?.VITEST) ||
	(_importMetaEnv && (_importMetaEnv.VITEST as string)) ||
	undefined;
const dev = _env === 'development' || _env === 'test' || _vitest === '1' || _vitest === 'true';

// Allow any JS value (string, number, object, array, etc.) as a log payload
type TitleParam = string | [string, string];

class Logger {
	private readonly isUAT: boolean;

	constructor() {
		this.isUAT = dev;
	}

	/**
	 * Extract caller information from Error stack trace
	 * Returns an object with a short location and full stack trace
	 */
	private extractLocationFromLine(line: string): string | undefined {
		const candidate = this.getCandidateFromLine(line);
		if (!candidate) return undefined;

		return this.parseFileLineCol(candidate);
	}

	/**
	 * Extract the candidate substring that likely contains file:line:col
	 * Examples: "(path/to/file.js:123:45)" or "at path/to/file.js:123:45"
	 */
	private getCandidateFromLine(line: string): string | undefined {
		const parenStart = line.indexOf('(');
		const parenEnd = line.lastIndexOf(')');
		if (parenStart !== -1 && parenEnd !== -1 && parenEnd > parenStart) {
			return line.slice(parenStart + 1, parenEnd).trim();
		}

		const atIndex = line.indexOf('at ');
		if (atIndex !== -1) return line.slice(atIndex + 3).trim();
		return undefined;
	}

	/**
	 * Parse a candidate string of the form filePath:line:col
	 * Handles Windows drive letters by joining remaining parts with ':'
	 */
	private parseFileLineCol(candidate: string): string | undefined {
		const parts = candidate.split(':');
		if (parts.length < 3) return undefined;

		const col = parts.pop()!;
		const lineNum = parts.pop()!;

		if (!this.isUnsignedInteger(lineNum) || !this.isUnsignedInteger(col)) return undefined;

		const filePath = parts.join(':');
		const fileName = filePath.split('/').pop() || filePath;
		return `${fileName}:${lineNum}`;
	}

	private isUnsignedInteger(s: string): boolean {
		// Avoid using regex here to completely eliminate any risk of
		// backtracking or regex engine surprises. Perform a simple
		// character-code check that's O(n) and deterministic.
		if (s.length === 0) return false;
		for (let i = 0; i < s.length; i++) {
			const c = s.codePointAt(i);
			if (c === undefined) return false;
			if (c < 48 || c > 57) return false; // '0'..'9'
		}
		return true;
	}

	private getCallerContext(): { location: string; stack?: string } {
		try {
			const err = new Error('dev-logger:getCallerContext');
			const stack = err.stack;
			if (!stack) return { location: '' };

			const lines = stack.split('\n');
			for (let i = 2; i < lines.length; i++) {
				const line = lines[i] || '';
				if (line.includes('dev-logger')) continue;
				const location = this.extractLocationFromLine(line) ?? (line.trim() || undefined);
				if (location) return { location, stack };
			}
			return { location: '', stack };
		} catch {
			return { location: '' };
		}
	}

	/**
	 * Central emit helper to output structured logs: Title, { caller, value }
	 */
	private emit(title: string, msg: unknown, color = 'color:#577D86'): void {
		if (!this.isUAT) return;
		const ctx = this.getCallerContext();
		// Compact mode: only include short location (file:line). Full stack is available on ctx.stack if needed.
		const caller = ctx.location;
		// Use a simple styled title and structured object for the value
		console.log(`%c${title}`, color, { caller, value: msg });
	}

	/**
	 * Emit a structured log that may be grouped when `msg` is a non-empty object.
	 * This consolidates the repeated branching used by request/requestor/debug.
	 */
	private emitStructured(
		titleParam: TitleParam,
		msg?: unknown,
		icon = '⛬',
		color = '#00e5ff'
	): void {
		if (!this.isUAT) return;
		const ctx = this.getCallerContext();
		const caller = ctx.location;
		const titleText = Array.isArray(titleParam) ? titleParam[0] : titleParam;
		const titleExtra = Array.isArray(titleParam) ? titleParam[1] : '';

		if (typeof msg === 'object' && msg !== null && Object.keys(msg).length > 0) {
			console.groupCollapsed(`%c${icon} ${titleText}`, `color:${color}`);
			console.log({ caller, value: titleExtra });
			Object.keys(msg as Record<string, unknown>).forEach((key) => {
				console.log(`%c${key}`, 'color:#f5a15a', (msg as Record<string, unknown>)[key]);
			});
			console.groupEnd();
		} else {
			console.log(`%c${icon} ${titleText}`, `color:${color}`, { caller, value: titleExtra || msg });
		}
	}

	success(title: string, msg?: unknown): void {
		this.emit(title, msg, 'color:#40ff00');
	}

	info(title: string, msg?: unknown): void {
		this.emit(title, msg, 'color:#00e5ff');
	}

	warning(title: string, msg?: unknown): void {
		this.emit(title, msg, 'color:#f5a15a');
	}

	error(title: string, msg?: unknown): void {
		this.emit(title, msg, 'color:#ff6b6b');
	}

	default(title: string, msg?: unknown, color = '#577D86'): void {
		this.emit(title, msg, `color:${color}`);
	}

	requestor(title: TitleParam, msg?: unknown): void {
		this.emitStructured(title, msg, '⛬', '#74959A');
	}

	request(title: TitleParam, msg?: unknown): void {
		this.emitStructured(title, msg, '⛬', '#00e5ff');
	}

	debug(title: TitleParam, msg?: unknown): void {
		this.emitStructured(title, msg, '⛛', '#40ff00');
	}

	render(
		[title, msg = '']: [string, string?],
		msgMap: Record<string, unknown>,
		color: string = '#40ff00'
	): void {
		if (this.isUAT) {
			const ctx = this.getCallerContext();
			const caller = ctx.location;
			console.groupCollapsed(`%c⛤ ${title}`, `color:${color}`);
			console.log({ caller, value: msg });

			Object.keys(msgMap).forEach((key) => {
				console.log(`%c${key}`, 'color:#f5a15a', msgMap[key]);
			});
			console.groupEnd();
		}
	}
}

export const logger = new Logger();
