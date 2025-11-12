import { writable, derived, get } from 'svelte/store';
import { chatService } from '$lib/services/chat.service';
import { user } from './auth.store';
import type { ChatConversation, Message, ChatState } from '$lib/types';

const initialState: ChatState = {
	conversations: [],
	messages: {},
	selectedUserId: null,
	loading: {
		conversations: false,
		messages: false
	}
};

function createChatStore() {
	const { subscribe, set, update } = writable<ChatState>(initialState);

	return {
		subscribe,

		/**
		 * Load conversations
		 */
		async loadConversations(currentUserId?: string) {
			update((state) => ({
				...state,
				loading: { ...state.loading, conversations: true }
			}));

			try {
				const conversations = await chatService.getConversations(currentUserId);
				update((state) => ({
					...state,
					conversations,
					loading: { ...state.loading, conversations: false }
				}));
			} catch (error) {
				console.error('Failed to load conversations:', error);
				update((state) => ({
					...state,
					loading: { ...state.loading, conversations: false }
				}));
			}
		},

		/**
		 * Load messages for a user
		 */
		async loadMessages(userId: string, currentUserId?: string) {
			update((state) => ({
				...state,
				selectedUserId: userId,
				loading: { ...state.loading, messages: true }
			}));

			try {
				const messages = await chatService.getMessages(userId, 50, 0, currentUserId);
				update((state) => ({
					...state,
					messages: { ...state.messages, [userId]: messages },
					loading: { ...state.loading, messages: false }
				}));
			} catch (error) {
				console.error('Failed to load messages:', error);
				update((state) => ({
					...state,
					loading: { ...state.loading, messages: false }
				}));
			}
		},

		/**
		 * Add a message
		 */
		addMessage(userId: string, message: Message) {
			update((state) => ({
				...state,
				messages: {
					...state.messages,
					[userId]: [...(state.messages[userId] || []), message]
				}
			}));
		},

		/**
		 * Update conversation
		 */
		updateConversation(userId: string, updates: Partial<ChatConversation>) {
			update((state) => ({
				...state,
				conversations: state.conversations.map((c) =>
					c.userId === userId ? { ...c, ...updates } : c
				)
			}));
		},

		/**
		 * Clear state
		 */
		clear() {
			set(initialState);
		}
	};
}

export const chatStore = createChatStore();

// Derived stores
export const selectedConversation = derived(
	chatStore,
	($chat) => $chat.conversations.find((c) => c.userId === $chat.selectedUserId) || null
);

export const selectedMessages = derived(chatStore, ($chat) =>
	$chat.selectedUserId ? $chat.messages[$chat.selectedUserId] || [] : []
);
