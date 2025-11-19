import type { Notification } from '$lib/types';
import { safeToString } from '../utils';

/**
 * Normalize various backend notification shapes into the frontend `Notification` type.
 * Guarantees `_id` and `createdAt` are present as strings.
 */
export function normalizeNotification(raw: unknown, idx = 0): Notification {
	const obj = (raw as Record<string, unknown>) || {};
	const idVal =
		obj['_id'] ??
		obj['id'] ??
		obj['uuid'] ??
		obj['_id_str'] ??
		`${Date.now()}-${Math.random()}-${idx}`;
	const created = obj['createdAt'] ?? obj['created_at'];

	return {
		_id: safeToString(idVal, `${Date.now()}-${Math.random()}-${idx}`),
		userId: safeToString(obj['userId'] ?? obj['user_id'] ?? obj['user'] ?? ''),
		type: (obj['type'] as Notification['type']) ?? 'system',
		title: safeToString(obj['title'] ?? ''),
		message: safeToString(obj['message'] ?? ''),
		read: Boolean(obj['read'] ?? false),
		createdAt: created ? new Date(safeToString(created)).toISOString() : new Date().toISOString()
	} as Notification;
}

export default normalizeNotification;
