<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { env } from '$env/dynamic/public';
	import { authStore, user } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { notificationStore } from '$lib/stores/notification.store';
	import { themeStore } from '$lib/stores/theme.store';
	import { chatService } from '$lib/services/chat.service';
	import { wsService } from '$lib/services/websocket.service';
	import { sanitizeMessage } from '$lib/utils';
	import { initSignalWithRestore } from '$lib/crypto/signal';
	import { logger } from '$lib/services/dev-logger';
	import type { ChatConversation, Message, MessageListHandle } from '$lib/types';

	import ChatList from '$lib/components/ChatList.svelte';
	import ChatHeader from '$lib/components/ChatHeader.svelte';
	import MessageList from '$lib/components/MessageList.svelte';
	import MessageInput from '$lib/components/MessageInput.svelte';
	import NotificationModal from '$lib/components/NotificationModal.svelte';

	let conversations: ChatConversation[] = [];
	let messages: Message[] = [];
	let selectedConversation: ChatConversation | null = null;
	let typingUsers = new Set<string>();
	let loading = {
		conversations: false,
		messages: false
	};
	let showNotificationModal = false;

	// Strongly-typed reference to MessageList component for programmatic scrolling
	let messageListComponent: MessageListHandle | null = null;

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

		// Initialize Signal Protocol keys (non-blocking background task)
		// This ensures encryption keys are ready before sending/receiving messages
		if (typeof window !== 'undefined' && $user) {
			const userId = $user._id as string;
			let deviceId: string = localStorage.getItem('deviceId') ?? '';
			if (!deviceId) {
				deviceId =
					typeof crypto !== 'undefined' && 'randomUUID' in crypto
						? crypto.randomUUID()
						: String(Date.now()) + '-' + Math.floor(Math.random() * 1e6);
				localStorage.setItem('deviceId', deviceId);
			}
			const apiBase = env.PUBLIC_API_URL || 'http://localhost:85';
			
			// Initialize in background - don't block page load
			initSignalWithRestore(userId, deviceId, apiBase)
				.then(success => {
					if (success) {
						logger.success('[Chat] Signal Protocol initialized successfully');
					} else {
						logger.warning('[Chat] Signal Protocol initialization failed');
						toastStore.warning('Encryption setup incomplete. Messages may not be encrypted.');
					}
				})
				.catch(err => {
					logger.error('[Chat] Signal Protocol initialization error:', err);
				});
		}

		// Connect WebSocket (auth handled via httpOnly cookie)
		wsService.connect();

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
			const currentUserId = $user?._id as string | undefined;
			conversations = await chatService.getConversations(currentUserId);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Failed to load conversations';
			toastStore.error(message);
		} finally {
			loading.conversations = false;
		}
	}

	async function selectConversation(userId: string) {
		const conversation = conversations.find((c) => c.userId === userId);
		if (!conversation || !$user) return;

		selectedConversation = conversation;
		loading.messages = true;

		const currentUserId = $user._id as string;

		try {
			messages = await chatService.getMessages(userId, 50, 0, currentUserId);
			await chatService.markAsRead(userId);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Failed to load messages';
			toastStore.error(message);
			messages = [];
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
		const currentUserId = $user._id as string;

		try {
			const message = await chatService.sendMessage(
				{
					receiverId,
					content: sanitizedContent
				},
				currentUserId
			);

			// Add message to local state
			messages = [...messages, message];

			// Update conversation list
			conversations = conversations.map((c) =>
				c.userId === receiverId
					? { ...c, lastMessage: sanitizedContent, lastMessageTime: message.timestamp }
					: c
			);

			// Broadcast via WebSocket for real-time delivery to receiver
			// Pass the message ID so backend knows it's already saved
			if (wsService.isConnected()) {
				wsService.sendMessage({
					...message,
					_id: message._id // Include ID to prevent duplicate save
				});
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Failed to send message';
			toastStore.error(message);
		}
	}

	async function handleIncomingMessage(message: Message) {
		logger.debug('[Chat] handleIncomingMessage called:', {
			_id: message._id,
			senderId: message.senderId,
			receiverId: message.receiverId,
			contentLength: String(message.content?.length || 0),
			currentUser: String($user?._id || '')
		});

		// Decrypt message content if encrypted
		let displayContent = message.content;
		let decryptionFailed = false;
		try {
			const parsed = JSON.parse(message.content);
			if (parsed && parsed.__encrypted && $user) {
				logger.info('[Chat] Message is encrypted, attempting decryption...');
				const currentUserId = $user._id as string;
				const { decryptMessage } = await import('$lib/crypto/signal');
				const ctObj = { type: parsed.type, body: parsed.body };
				displayContent = await decryptMessage(message.senderId, ctObj, currentUserId);
				// Update the message object with decrypted content
				message.content = displayContent;
				logger.success('[Chat] Message decrypted successfully');
			}
		} catch (decryptError) {
			logger.error('[Chat] Decryption failed:', decryptError);
			decryptionFailed = true;
			// Show user-friendly error message instead of encrypted JSON
			message.content = '🔒 [Message could not be decrypted - encryption keys may be out of sync]';
		}

		// Save decrypted message to local storage (Signal-style)
		if ($user) {
			try {
				const { getMessageStore } = await import('$lib/crypto/messageStore');
				const messageStore = getMessageStore($user._id as string);
				await messageStore.saveMessage(message);
				logger.info('[Chat] Saved incoming message to local storage');
			} catch (err) {
				logger.error('[Chat] Failed to save message to local storage:', err);
			}
		}

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

		// Update conversations list with decrypted content
		const existingConversation = conversations.find(
			(c) => c.userId === message.senderId || c.userId === message.receiverId
		);

		if (existingConversation) {
			conversations = conversations.map((c) =>
				c.userId === message.senderId || c.userId === message.receiverId
					? {
							...c,
							lastMessage: displayContent,
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

		// Show notification with decrypted content
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

	function toggleNotificationModal() {
		showNotificationModal = !showNotificationModal;
		if (showNotificationModal) {
			void notificationStore.fetch();
		}
	}
</script>

<svelte:head>
	<title>Chat - {$user?.username || 'User'}</title>
</svelte:head>

<div class="flex h-screen flex-col" style="background: var(--bg-primary);">
	<!-- Modern Top Navigation with Glass Effect -->
	<nav class="glass-strong border-b" style="border-color: var(--border-subtle);">
		<div class="flex items-center justify-between px-6 py-4">
			<div class="flex items-center gap-4">
				<!-- Mobile: toggle sidebar -->
				<button
					class="hover-lift inline-flex items-center justify-center rounded-lg p-2 transition-all duration-200 md:hidden"
					style="color: var(--text-secondary);"
					onclick={() => (showSidebar = !showSidebar)}
					aria-label="Toggle conversations"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h16"
						/>
					</svg>
				</button>
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500 to-purple-600"
					>
						<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
							/>
						</svg>
					</div>
					<div>
						<h1 class="text-lg font-semibold" style="color: var(--text-primary);">Chat</h1>
						<p class="text-xs" style="color: var(--text-tertiary);">Stay connected</p>
					</div>
				</div>
			</div>

			<div class="flex items-center gap-2">
				<!-- Notifications with modern badge -->
				<button
					onclick={toggleNotificationModal}
					class="hover-lift relative rounded-xl p-2.5 transition-all duration-200"
					style="color: var(--text-secondary); background: var(--bg-hover);"
					title="Notifications"
					aria-label="Open notifications"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
						/>
					</svg>
					{#if $notificationStore.unreadCount > 0}
						<span
							class="animate-scale-in absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold text-white"
							style="background: linear-gradient(135deg, #ec4899, #ef4444); box-shadow: 0 2px 8px rgba(236, 72, 153, 0.4);"
						>
							{$notificationStore.unreadCount > 9 ? '9+' : $notificationStore.unreadCount}
						</span>
					{/if}
				</button>

				<!-- Theme toggle -->
				<button
					onclick={() => themeStore.toggle()}
					class="hover-lift btn ml-1 rounded-xl p-2.5 transition-all duration-200"
					class:btn-primary={$themeStore === 'light'}
					style="color: var(--text-secondary); background: var(--bg-hover);"
					title="Toggle theme"
					aria-label="Toggle theme"
					aria-pressed={$themeStore === 'dark'}
				>
					<span class="sr-only">Toggle light/dark theme</span>
					{#if $themeStore === 'dark'}
						<!-- Sun icon for switching to light -->
						<svg
							class="h-5 w-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M7.05 16.95l-1.414 1.414m12.728 0l-1.414-1.414M7.05 7.05L5.636 5.636"
							/>
						</svg>
					{:else}
						<!-- Moon icon for switching to dark -->
						<svg
							class="h-5 w-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
							/>
						</svg>
					{/if}
				</button>

				<!-- User Menu with modern styling -->
				<div class="ml-2 flex items-center gap-3">
					<div class="hidden flex-col items-end sm:flex">
						<span class="text-sm font-medium" style="color: var(--text-primary);"
							>{$user?.username || 'User'}</span
						>
						<span class="text-xs" style="color: var(--text-tertiary);">Online</span>
					</div>
					<button
						onclick={handleLogout}
						class="hover-lift inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200"
						style="background: var(--color-error-bg); color: var(--color-error); border: 1px solid var(--color-error-border);"
						aria-label="Logout"
					>
						Logout
					</button>
				</div>
			</div>
		</div>
	</nav>

	<!-- Main Chat Interface with Modern Design -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Sidebar - Conversations List (desktop) with glass effect -->
		<div
			class="hidden w-80 shrink-0 md:block"
			style="background: var(--bg-secondary); border-right: 1px solid var(--border-subtle);"
		>
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

		<!-- Mobile sidebar overlay with modern backdrop -->
		{#if showSidebar}
			<div class="fixed inset-0 z-40 flex md:hidden">
				<!-- Modern Backdrop -->
				<button
					class="absolute inset-0 transition-all duration-300"
					style="background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px);"
					aria-hidden="true"
					onclick={() => (showSidebar = false)}
				></button>
				<!-- Sliding Panel with animation -->
				<div
					class="glass-strong animate-slide-in relative z-50 w-80 max-w-full"
					style="box-shadow: var(--shadow-strong);"
				>
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

		<!-- Chat Area with modern styling -->
		<div class="flex flex-1 flex-col" style="background: var(--bg-primary);">
			{#if selectedConversation}
				<ChatHeader recipient={selectedConversation} {typingUsers} />
				<MessageList
					bind:this={messageListComponent}
					{messages}
					currentUserId={$user?._id || ''}
					loading={loading.messages}
					conversationId={selectedConversation.userId}
				/>
				<MessageInput
					on:send={(e) => sendMessage(e.detail)}
					on:typing={(e) => handleTyping(e.detail)}
					disabled={!wsService.isConnected()}
				/>
			{:else}
				<div
					class="animate-fade-in flex flex-1 items-center justify-center"
					style="color: var(--text-secondary);"
				>
					<div class="text-center">
						<div
							class="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-2xl"
							style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle);"
						>
							<svg
								class="h-12 w-12"
								style="color: var(--text-tertiary);"
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
						</div>
						<h3 class="mb-2 text-xl font-semibold" style="color: var(--text-primary);">
							No conversation selected
						</h3>
						<p class="text-sm" style="color: var(--text-tertiary);">
							Choose a conversation from the sidebar to start chatting
						</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Notification Modal -->
<NotificationModal isOpen={showNotificationModal} onClose={() => (showNotificationModal = false)} />
