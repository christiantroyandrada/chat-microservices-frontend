import type { Message } from '$lib/types';

export function mergeDelivery(cached: Message, incoming: Message): Message {
	const rank = { sent: 0, delivered: 1, read: 2 };
	const status =
		rank[cached.status ?? 'sent'] > rank[incoming.status ?? 'sent']
			? cached.status
			: incoming.status;
	return { ...cached, status, read: status === 'read' || cached.read === true };
}

export function mergeMessages(messages: Message[], updates: Message[]): Message[] {
	const merged = new Map(messages.map((message) => [message._id, message]));
	for (const update of updates) {
		if (
			update.sendState &&
			update.sendState !== 'accepted' &&
			[...merged.values()].some(
				(existing) =>
					existing.senderId === update.senderId &&
					existing.clientMessageId === update.clientMessageId &&
					existing.sendState === 'accepted'
			)
		)
			continue;
		if (update.clientMessageId) {
			for (const [id, existing] of merged) {
				if (
					existing.senderId === update.senderId &&
					existing.clientMessageId === update.clientMessageId &&
					id !== update._id
				)
					merged.delete(id);
			}
		}
		const previous = merged.get(update._id);
		merged.set(update._id, previous ? mergeDelivery({ ...previous, ...update }, previous) : update);
	}
	return [...merged.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
