import { dev } from '$app/environment';

// Allow any JS value (string, number, object, array, etc.) as a log payload
type LogMessage = unknown;
type TitleParam = string | [string, string];

class Logger {
	private isUAT: boolean;

	constructor() {
		this.isUAT = dev;
	}

	/**
	 * Extract caller information from Error stack trace
	 * Returns an object with a short location and full stack trace
	 */
	private getCallerContext(): { location: string; stack?: string } {
		try {
			const err = new Error();
			const stack = err.stack;
			if (!stack) return { location: '' };

			const lines = stack.split('\n');
			for (let i = 2; i < lines.length; i++) {
				const line = lines[i] || '';
				if (line.includes('dev-logger')) continue;
				// Try to capture a file:line:col pattern
				const m = line.match(/\((.*):(\d+):(\d+)\)/) || line.match(/at\s+(.*):(\d+):(\d+)/);
				if (m) {
					const [, filePath, lineNum] = m;
					const fileName = filePath.split('/').pop() || filePath;
					return { location: `${fileName}:${lineNum}`, stack };
				}
				// fallback - use the raw line
				if (line.trim()) return { location: line.trim(), stack };
			}
			return { location: '', stack };
		} catch {
			return { location: '' };
		}
	}

	/**
	 * Central emit helper to output structured logs: Title, { caller, value }
	 */
	private emit(title: string, msg: LogMessage, color = 'color:#577D86'): void {
		if (!this.isUAT) return;
		const ctx = this.getCallerContext();
		// Compact mode: only include short location (file:line). Full stack is available on ctx.stack if needed.
		const caller = ctx.location;
		// Use a simple styled title and structured object for the value
		console.log(`%c${title}`, color, { caller, value: msg });
	}

	success(title: string, msg?: LogMessage): void {
		this.emit(title, msg, 'color:#40ff00');
	}

	info(title: string, msg?: LogMessage): void {
		this.emit(title, msg, 'color:#00e5ff');
	}

	warning(title: string, msg?: LogMessage): void {
		this.emit(title, msg, 'color:#f5a15a');
	}

	error(title: string, msg?: LogMessage): void {
		this.emit(title, msg, 'color:#ff6b6b');
	}

	default(title: string, msg?: LogMessage, color = '#577D86'): void {
		this.emit(title, msg, `color:${color}`);
	}

	requestor(title: TitleParam, msg?: LogMessage): void {
		if (this.isUAT) {
			const ctx = this.getCallerContext();
			const caller = ctx.location;

			if (typeof msg === 'object' && msg !== null && Object.keys(msg).length > 0) {
				const titleText = Array.isArray(title) ? title[0] : title;
				const titleExtra = Array.isArray(title) ? title[1] : '';
				
				console.groupCollapsed(`%c⛬ ${titleText}`, 'color:#74959A');
				console.log({ caller, value: titleExtra });

				Object.keys(msg as Record<string, unknown>).forEach((key) => {
					console.log(`%c${key}`, 'color:#f5a15a', (msg as Record<string, unknown>)[key]);
				});
				console.groupEnd();
			} else {
				const titleText = Array.isArray(title) ? title[0] : title;
				const titleExtraLocal = Array.isArray(title) ? title[1] : '';
				console.log(`%c⛬ ${titleText}`, 'color:#74959A', { caller, value: titleExtraLocal || msg });
			}
		}
	}

	request(title: TitleParam, msg?: LogMessage): void {
		if (this.isUAT) {
			const ctx = this.getCallerContext();
			const caller = ctx.location;

			if (typeof msg === 'object' && msg !== null && Object.keys(msg).length > 0) {
				const titleText = Array.isArray(title) ? title[0] : title;
				const titleExtra = Array.isArray(title) ? title[1] : '';
				
				console.groupCollapsed(`%c⛬ ${titleText}`, 'color:#00e5ff');
				console.log({ caller, value: titleExtra });

				Object.keys(msg as Record<string, unknown>).forEach((key) => {
					console.log(`%c${key}`, 'color:#f5a15a', (msg as Record<string, unknown>)[key]);
				});
				console.groupEnd();
			} else {
				const titleText = Array.isArray(title) ? title[0] : title;
				const titleExtraLocal = Array.isArray(title) ? title[1] : '';
				console.log(`%c⛬ ${titleText}`, 'color:#00e5ff', { caller, value: titleExtraLocal || msg });
			}
		}
	}

	debug(title: TitleParam, msg?: LogMessage): void {
		if (this.isUAT) {
			const ctx = this.getCallerContext();
			const caller = ctx.location;

			if (typeof msg === 'object' && msg !== null && Object.keys(msg).length > 0) {
				const titleText = Array.isArray(title) ? title[0] : title;
				
				console.groupCollapsed(`%c⛛ ${titleText}`, 'color:#40ff00');
				console.log({ caller, value: msg });

				Object.keys(msg as Record<string, unknown>).forEach((key) => {
					console.log(`%c${key}`, 'color:#F7C04A', (msg as Record<string, unknown>)[key]);
				});
				console.groupEnd();
			} else {
				const titleText = Array.isArray(title) ? title[0] : title;
				console.log(`%c⛛ ${titleText}`, 'color:#40ff00', { caller, value: msg });
			}
		}
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
