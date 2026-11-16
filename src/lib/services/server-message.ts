import type { Message, ServerMessage } from '$lib/types';
import { ContractBoundaryError, assertNonEmptyString, assertObject } from './contract-boundary';

export function assertValidServerMessage(
	raw: unknown,
	context: string
): asserts raw is ServerMessage {
	const obj = assertObject(raw, context, 'message');
	const id = (obj as Record<string, unknown>)._id ?? (obj as Record<string, unknown>).id;
	if (typeof id !== 'string' || id.length === 0) {
		throw new ContractBoundaryError(`${context}: id or _id must be non-empty string`);
	}
	assertNonEmptyString((obj as Record<string, unknown>).senderId, context, 'senderId');
	assertNonEmptyString((obj as Record<string, unknown>).receiverId, context, 'receiverId');
	const status = (obj as Record<string, unknown>).status;
	if (status !== 'NotDelivered' && status !== 'Delivered' && status !== 'Seen') {
		throw new ContractBoundaryError(`${context}: status must be NotDelivered, Delivered, or Seen`);
	}
	const messageRaw = (obj as Record<string, unknown>).message;
	const contentRaw = (obj as Record<string, unknown>).content;
	const wireContent = messageRaw ?? contentRaw;
	if (typeof wireContent !== 'string') {
		throw new ContractBoundaryError(`${context}: message/content must be string`);
	}
}

export function normalizeMessage(serverMsg: ServerMessage): Message {
	const deliveryStatus = serverMsg.status;
	const status =
		deliveryStatus === 'Seen' ? 'read' : deliveryStatus === 'Delivered' ? 'delivered' : 'sent';
	const read = deliveryStatus === 'Seen';
	const id = (serverMsg._id ?? serverMsg.id) as string;
	return {
		_id: id,
		senderId: serverMsg.senderId,
		senderUsername: serverMsg.senderUsername || serverMsg.senderName || undefined,
		receiverId: serverMsg.receiverId,
		content: (serverMsg.message ?? serverMsg.content) as string,
		timestamp: serverMsg.timestamp ?? serverMsg.createdAt ?? new Date().toISOString(),
		status,
		read,
		createdAt: serverMsg.createdAt,
		updatedAt: serverMsg.updatedAt,
		clientMessageId:
			typeof serverMsg.clientMessageId === 'string' ? serverMsg.clientMessageId : undefined
	} as Message;
}
