<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore, user } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { notificationStore } from '$lib/stores/notification.store';
	import { chatService } from '$lib/services/chat.service';
	import { wsService } from '$lib/services/websocket.service';
	import { authService } from '$lib/services/auth.service';
	import { sanitizeMessage } from '$lib/utils';
	import type { ChatConversation, Message } from '$lib/types';

	import ChatList from '$lib/components/ChatList.svelte';
	import ChatHeader from '$lib/components/ChatHeader.svelte';
	import MessageList from '$lib/components/MessageList.svelte';
	import MessageInput from '$lib/components/MessageInput.svelte';

	let conversations: ChatConversation[] = [];
	let messages: Message[] = [];
	let selectedConversation: ChatConversation | null = null;
	let typingUsers = new Set<string>();
	let loading = {
		conversations: false,
		messages: false
	};

	let unsubscribeWsMessage: (() => void) | null = null;
	let unsubscribeWsTyping: (() => void) | null = null;
	let unsubscribeWsStatus: (() => void) | null = null;
	let showSidebar = false;

	onMount(async () => {
		// Check authentication
		if (!$user) {
			await authStore.init();
			if (!$user) {
				void goto('/login');
				return;
			}
		}

		// Connect WebSocket
		const token = authService.getToken();
		if (token) {
			wsService.connect(token);
		}

		// Set up WebSocket listeners
		unsubscribeWsMessage = wsService.onMessage(handleIncomingMessage);
		unsubscribeWsTyping = wsService.onTyping(handleTypingIndicator);
		unsubscribeWsStatus = wsService.onStatusChange(handleConnectionStatus);

		// Load initial data
		await loadConversations();
		await notificationStore.fetch();
	});

	onDestroy(() => {
		// Clean up WebSocket listeners
		if (unsubscribeWsMessage) unsubscribeWsMessage();
		if (unsubscribeWsTyping) unsubscribeWsTyping();
		if (unsubscribeWsStatus) unsubscribeWsStatus();

		wsService.disconnect();
	});

	async function loadConversations() {
		loading.conversations = true;
		try {
			conversations = await chatService.getConversations();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Failed to load conversations';
			toastStore.error(message);
		} finally {
			loading.conversations = false;
		}
	}

	async function selectConversation(userId: string) {
		const conversation = conversations.find((c) => c.userId === userId);
		if (!conversation) return;

		selectedConversation = conversation;
		loading.messages = true;

		try {
			messages = await chatService.getMessages(userId);
			await chatService.markAsRead(userId);

			// Update unread count
			conversations = conversations.map((c) =>
				c.userId === userId ? { ...c, unreadCount: 0 } : c
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Failed to load messages';
			toastStore.error(message);
		} finally {
			loading.messages = false;
		}
	}

	async function sendMessage(content: string) {
		if (!selectedConversation || !$user) return;

		// Sanitize and validate message content
		const sanitizedContent = sanitizeMessage(content);
		if (!sanitizedContent) {
			toastStore.error('Invalid message content');
			return;
		}

		const receiverId = selectedConversation.userId;

		try {
			const message = await chatService.sendMessage({
				receiverId,
				content: sanitizedContent
			});

			// Add message to local state
			messages = [...messages, message];

			// Update conversation list
			conversations = conversations.map((c) =>
				c.userId === receiverId
					? { ...c, lastMessage: sanitizedContent, lastMessageTime: message.timestamp }
					: c
			);

			// Send via WebSocket for real-time delivery
			if (wsService.isConnected()) {
				wsService.sendMessage(message);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Failed to send message';
			toastStore.error(message);
		}
	}

	function handleIncomingMessage(message: Message) {
		// Add message to the list if it's for current conversation
		if (
			selectedConversation &&
			(message.senderId === selectedConversation.userId ||
				message.receiverId === selectedConversation.userId)
		) {
			messages = [...messages, message];

			// Mark as read if conversation is active
			if (message.senderId === selectedConversation.userId) {
				void chatService.markAsRead(message.senderId);
			}
		}

		// Update conversations list
		const existingConversation = conversations.find(
			(c) => c.userId === message.senderId || c.userId === message.receiverId
		);

		if (existingConversation) {
			conversations = conversations.map((c) =>
				c.userId === message.senderId || c.userId === message.receiverId
					? {
							...c,
							lastMessage: message.content,
							lastMessageTime: message.timestamp,
							unreadCount:
								selectedConversation?.userId !== message.senderId ? (c.unreadCount || 0) + 1 : 0
						}
					: c
			);
		} else {
			// New conversation
			void loadConversations();
		}

		// Show notification
		if (message.senderId !== $user?._id) {
			toastStore.info(`New message from ${message.senderUsername || 'User'}`);
		}
	}

	function handleTypingIndicator(userId: string, isTyping: boolean) {
		if (isTyping) {
			typingUsers.add(userId);
		} else {
			typingUsers.delete(userId);
		}
		typingUsers = new Set(typingUsers);
	}

	function handleConnectionStatus(status: 'connected' | 'disconnected' | 'reconnecting') {
		switch (status) {
			case 'connected':
				toastStore.success('Connected to chat');
				break;
			case 'disconnected':
				toastStore.warning('Disconnected from chat');
				break;
			case 'reconnecting':
				toastStore.info('Reconnecting...');
				break;
		}
	}

	function handleTyping(isTyping: boolean) {
		if (selectedConversation && wsService.isConnected()) {
			wsService.sendTyping(selectedConversation.userId, isTyping);
		}
	}

	/**
	 * Create a new conversation with a selected user (from ChatList create event).
	 * If a conversation already exists, select it. Otherwise, optimistically open a new thread
	 * and refresh the conversations list in the background.
	 */
	async function createConversation(user: unknown) {
		const u = user as Record<string, unknown>;
		const userId = String(u.userId ?? '');
		if (!userId) return;

		const existing = conversations.find((c) => c.userId === userId);
		if (existing) {
			await selectConversation(existing.userId);
			return;
		}

		// Optimistically open a conversation UI for this user
		selectedConversation = {
			userId,
			username: String(u.username ?? '')
		};
		messages = [];

		// Refresh conversations list in background to pick up server-side created threads
		void loadConversations();
	}

	function handleLogout() {
		authStore.logout();
	}
</script>

<svelte:head>
	<title>Chat - {$user?.username || 'User'}</title>
</svelte:head>

<div class="flex h-screen flex-col bg-gray-100">
	<!-- Top Navigation -->
	<nav class="border-b border-gray-200 bg-white px-4 py-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<!-- Mobile: toggle sidebar -->
				<button
					class="mr-2 inline-flex items-center justify-center rounded-md p-2 text-gray-600 hover:bg-gray-100 md:hidden"
					onclick={() => (showSidebar = !showSidebar)}
					aria-label="Toggle conversations"
				>
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h16"
						/>
					</svg>
				</button>
				<h1 class="text-xl font-bold text-gray-900">Chat App</h1>
			</div>

			<div class="flex items-center gap-4">
				<!-- Notifications -->
				<button
					onclick={() => notificationStore.fetch()}
					class="relative rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
					title="Notifications"
				>
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
						/>
					</svg>
					{#if $notificationStore.unreadCount > 0}
						<span
							class="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-semibold text-white"
						>
							{$notificationStore.unreadCount > 9 ? '9+' : $notificationStore.unreadCount}
						</span>
					{/if}
				</button>

				<!-- User Menu -->
				<div class="flex items-center gap-2">
					<button
						onclick={handleLogout}
						class="ml-2 rounded-md px-3 py-1 text-sm text-red-600 transition-colors hover:bg-red-50"
					>
						Logout
					</button>
				</div>
			</div>
		</div>
	</nav>

	<!-- Main Chat Interface -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Sidebar - Conversations List (desktop) -->
		<div class="hidden w-80 shrink-0 md:block">
			<ChatList
				{conversations}
				selectedUserId={selectedConversation?.userId || null}
				currentUserId={$user?._id || null}
				currentUsername={$user?.username || ''}
				loading={loading.conversations}
				on:select={(e) => selectConversation(e.detail)}
				on:create={(e) => createConversation(e.detail)}
			/>
		</div>

		<!-- Mobile sidebar overlay -->
		{#if showSidebar}
			<div class="fixed inset-0 z-40 flex md:hidden">
				<!-- Backdrop -->
				<button
					class="absolute inset-0 bg-black opacity-40"
					aria-hidden="true"
					onclick={() => (showSidebar = false)}
				></button>
				<!-- Panel -->
				<div class="relative z-50 w-80 max-w-full bg-white shadow-xl">
					<ChatList
						{conversations}
						selectedUserId={selectedConversation?.userId || null}
						currentUserId={$user?._id || null}
						currentUsername={$user?.username || ''}
						loading={loading.conversations}
						onClose={() => (showSidebar = false)}
						on:select={(e) => {
							selectConversation(e.detail);
							showSidebar = false;
						}}
						on:create={(e) => {
							createConversation(e.detail);
							showSidebar = false;
						}}
					/>
				</div>
			</div>
		{/if}

		<!-- Chat Area -->
		<div class="flex flex-1 flex-col bg-white">
			{#if selectedConversation}
				<ChatHeader recipient={selectedConversation} {typingUsers} />
				<MessageList {messages} currentUserId={$user?._id || ''} loading={loading.messages} />
				<MessageInput
					on:send={(e) => sendMessage(e.detail)}
					on:typing={(e) => handleTyping(e.detail)}
					disabled={!wsService.isConnected()}
				/>
			{:else}
				<div class="flex flex-1 items-center justify-center text-gray-500">
					<div class="text-center">
						<svg
							class="mx-auto mb-4 h-24 w-24 text-gray-300"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
							/>
						</svg>
						<h3 class="mb-2 text-lg font-medium">No conversation selected</h3>
						<p class="text-sm">Choose a conversation from the sidebar to start chatting</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
