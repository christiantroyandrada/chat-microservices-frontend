/**
 * Shared validation utilities
 *
 * These validation rules are aligned with the backend validation in:
 * user-service/src/middleware/validation/authValidation.ts
 *
 * Keep these in sync to ensure consistent validation across frontend and backend.
 */

// Password validation constants - MUST match backend authValidation.ts
export const PASSWORD_REQUIREMENTS = {
	minLength: 8,
	maxLength: 128,
	// Special characters that are allowed (must match backend regex)
	specialChars: '@$!%*?&',
	specialCharsRegex: /[@$!%*?&]/
} as const;

// Username validation constants - MUST match backend authValidation.ts
export const USERNAME_REQUIREMENTS = {
	minLength: 3,
	maxLength: 30,
	// Valid username pattern (letters, numbers, underscores, hyphens)
	pattern: /^[a-z0-9_-]+$/i,
	errorMessage: 'Use 3-30 characters: letters, numbers, _ or -'
} as const;

// Email validation constants
export const EMAIL_REQUIREMENTS = {
	maxLength: 255
} as const;

/**
 * Validate password strength
 *
 * Requirements (aligned with backend):
 * - At least 8 characters
 * - At most 128 characters
 * - Contains uppercase and lowercase
 * - Contains numbers
 * - Contains special characters (@$!%*?&)
 */
export function validatePassword(password: string): {
	valid: boolean;
	errors: string[];
	requirements: {
		minLength: boolean;
		maxLength: boolean;
		hasUpperCase: boolean;
		hasLowerCase: boolean;
		hasNumber: boolean;
		hasSpecialChar: boolean;
	};
} {
	const requirements = {
		minLength: password.length >= PASSWORD_REQUIREMENTS.minLength,
		maxLength: password.length <= PASSWORD_REQUIREMENTS.maxLength,
		hasUpperCase: /[A-Z]/.test(password),
		hasLowerCase: /[a-z]/.test(password),
		hasNumber: /\d/.test(password),
		hasSpecialChar: PASSWORD_REQUIREMENTS.specialCharsRegex.test(password)
	};

	const errors: string[] = [];

	if (!requirements.minLength) {
		errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
	}
	if (!requirements.maxLength) {
		errors.push(`Password must not exceed ${PASSWORD_REQUIREMENTS.maxLength} characters`);
	}
	if (!requirements.hasUpperCase) {
		errors.push('Password must contain at least one uppercase letter');
	}
	if (!requirements.hasLowerCase) {
		errors.push('Password must contain at least one lowercase letter');
	}
	if (!requirements.hasNumber) {
		errors.push('Password must contain at least one number');
	}
	if (!requirements.hasSpecialChar) {
		errors.push(
			`Password must contain at least one special character (${PASSWORD_REQUIREMENTS.specialChars})`
		);
	}

	return {
		valid: errors.length === 0,
		errors,
		requirements
	};
}

/**
 * Validate username format
 */
export function validateUsername(username: string): {
	valid: boolean;
	error?: string;
} {
	const trimmed = username.trim().toLowerCase();

	if (trimmed.length < USERNAME_REQUIREMENTS.minLength) {
		return {
			valid: false,
			error: `Username must be at least ${USERNAME_REQUIREMENTS.minLength} characters`
		};
	}

	if (trimmed.length > USERNAME_REQUIREMENTS.maxLength) {
		return {
			valid: false,
			error: `Username must not exceed ${USERNAME_REQUIREMENTS.maxLength} characters`
		};
	}

	if (/\s/.test(trimmed)) {
		return {
			valid: false,
			error: 'Username cannot contain spaces'
		};
	}

	if (!USERNAME_REQUIREMENTS.pattern.test(trimmed)) {
		return {
			valid: false,
			error: `Username invalid. ${USERNAME_REQUIREMENTS.errorMessage}`
		};
	}

	return { valid: true };
}
