export type ResponseMode = 'envelope' | 'raw';

export class ContractBoundaryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ContractBoundaryError';
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export function assertNonEmptyString(value: unknown, context: string, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new ContractBoundaryError(`${context}: ${field} must be non-empty string`);
	}
	return value;
}

export function assertString(value: unknown, context: string, field: string): string {
	if (typeof value !== 'string') {
		throw new ContractBoundaryError(`${context}: ${field} must be string`);
	}
	return value;
}

export function assertStringOrNull(value: unknown, context: string, field: string): string | null {
	if (value !== null && typeof value !== 'string') {
		throw new ContractBoundaryError(`${context}: ${field} must be string or null`);
	}
	return value as string | null;
}

export function assertFiniteNumber(value: unknown, context: string, field: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new ContractBoundaryError(`${context}: ${field} must be finite number`);
	}
	return value;
}

export function assertArray(value: unknown, context: string, field: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new ContractBoundaryError(`${context}: ${field} must be array`);
	}
	return value;
}

export function assertObject(
	value: unknown,
	context: string,
	field: string
): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new ContractBoundaryError(`${context}: ${field} must be non-null object`);
	}
	return value as Record<string, unknown>;
}
