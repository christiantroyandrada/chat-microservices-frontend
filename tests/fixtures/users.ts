/**
 * User test fixtures
 */

import type { User, AuthUser } from '$lib/types';

export const testUsers = {
	alice: {
		_id: 'user-alice-123',
		username: 'alice',
		email: 'alice@test.com'
	} as User,

	bob: {
		_id: 'user-bob-456',
		username: 'bob',
		email: 'bob@test.com'
	} as User,

	charlie: {
		_id: 'user-charlie-789',
		username: 'charlie',
		email: 'charlie@test.com'
	} as User
};

export const testAuthUsers = {
	alice: {
		_id: 'user-alice-123',
		username: 'alice',
		email: 'alice@test.com',
		token: 'token-alice-123'
	} as AuthUser,

	bob: {
		_id: 'user-bob-456',
		username: 'bob',
		email: 'bob@test.com',
		token: 'token-bob-456'
	} as AuthUser
};
