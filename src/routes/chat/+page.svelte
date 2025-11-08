<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore, user } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { notificationStore } from '$lib/stores/notification.store';
	import { chatService } from '$lib/services/chat.service';
	import { wsService } from '$lib/services/websocket.service';
	import { authService } from '$lib/services/auth.service';
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
		} catch (error: any) {
			toastStore.error(error.message || 'Failed to load conversations');
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
		} catch (error: any) {
			toastStore.error(error.message || 'Failed to load messages');
		} finally {
			loading.messages = false;
		}
	}

	async function sendMessage(content: string) {
		if (!selectedConversation || !$user) return;

		const receiverId = selectedConversation.userId;

		try {
			const message = await chatService.sendMessage({
				receiverId,
				content
			});

			// Add message to local state
			messages = [...messages, message];

			// Update conversation list
			conversations = conversations.map((c) =>
				c.userId === receiverId
					? { ...c, lastMessage: content, lastMessageTime: message.timestamp }
					: c
			);

			// Send via WebSocket for real-time delivery
			if (wsService.isConnected) {
				wsService.sendMessage(message);
			}
		} catch (error: any) {
			toastStore.error(error.message || 'Failed to send message');
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
								selectedConversation?.userId !== message.senderId
									? (c.unreadCount || 0) + 1
									: 0
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
		if (selectedConversation && wsService.isConnected) {
			wsService.sendTyping(selectedConversation.userId, isTyping);
		}
	}

	function handleLogout() {
		authStore.logout();
	}
</script>

<svelte:head>
	<title>Chat - {$user?.username || 'User'}</title>
</svelte:head>

<div class="h-screen flex flex-col bg-gray-100">
	<!-- Top Navigation -->
	<nav class="bg-white border-b border-gray-200 px-4 py-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<h1 class="text-xl font-bold text-gray-900">Chat App</h1>
			</div>

			<div class="flex items-center gap-4">
				<!-- Notifications -->
				<button
					onclick={() => notificationStore.fetch()}
					class="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
					title="Notifications"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
						/>
					</svg>
					{#if $notificationStore.unreadCount > 0}
						<span
							class="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-semibold"
						>
							{$notificationStore.unreadCount > 9 ? '9+' : $notificationStore.unreadCount}
						</span>
					{/if}
				</button>

				<!-- User Menu -->
				<div class="flex items-center gap-2">
					<div
						class="w-8 h-8 rounded-full bg-linear-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-semibold">
						{(($user?.username?.[0] ?? '').toUpperCase())}
					</div>
					<span class="text-sm font-medium text-gray-900">{$user?.username}</span>
					<button
						onclick={handleLogout}
						class="ml-2 px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors"
					>
						Logout
					</button>
				</div>
			</div>
		</div>
	</nav>

	<!-- Main Chat Interface -->
	<div class="flex-1 flex overflow-hidden">
		<!-- Sidebar - Conversations List -->
		<div class="w-80 shrink-0">
			<ChatList
				{conversations}
				selectedUserId={selectedConversation?.userId || null}
				loading={loading.conversations}
				on:select={(e) => selectConversation(e.detail)}
			/>
		</div>

		<!-- Chat Area -->
		<div class="flex-1 flex flex-col bg-white">
			{#if selectedConversation}
				<ChatHeader recipient={selectedConversation} {typingUsers} />
				<MessageList
					{messages}
					currentUserId={$user?._id || ''}
					loading={loading.messages}
				/>
				<MessageInput
					on:send={(e) => sendMessage(e.detail)}
					on:typing={(e) => handleTyping(e.detail)}
					disabled={!wsService.isConnected}
				/>
			{:else}
				<div class="flex-1 flex items-center justify-center text-gray-500">
					<div class="text-center">
						<svg
							class="w-24 h-24 mx-auto mb-4 text-gray-300"
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
						<h3 class="text-lg font-medium mb-2">No conversation selected</h3>
						<p class="text-sm">Choose a conversation from the sidebar to start chatting</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
