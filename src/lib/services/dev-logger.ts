import { dev } from '$app/environment';

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
		// Try to capture a file:line:col pattern
		const re1 = /\((.+?):(\d+):(\d+)\)/;
		const re2 = /at\s+(.+?):(\d+):(\d+)/;
		const m = re1.exec(line) || re2.exec(line);
		if (!m) return undefined;
		const [, filePath, lineNum] = m;
		const fileName = filePath.split('/').pop() || filePath;
		return `${fileName}:${lineNum}`;
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
		color = '#40ff00'
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
