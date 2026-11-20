<script lang="ts">
	import Seal from '$lib/components/Seal.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore, user } from '$lib/stores/auth.store';
	import { toastStore } from '$lib/stores/toast.store';
	import { notificationStore } from '$lib/stores/notification.store';
	import { themeStore } from '$lib/stores/theme.store';
	import { chatService } from '$lib/services/chat.service';
	import { mergeMessages } from '$lib/services/message-merge';
	import { connectGoWebSocket } from '$lib/services/go-websocket';
	import { sanitizeMessage } from '$lib/utils';
	import { initSignalWithRestore, isSignalInitialized } from '$lib/crypto/signal';
	import { logger } from '$lib/services/dev-logger';
	import { API_BASE, getOrCreateDeviceId } from '$lib/config';
	import type { ChatConversation, Message, MessageListHandle } from '$lib/types';
	import ChatList from '$lib/components/ChatList.svelte';
	import ChatHeader from '$lib/components/ChatHeader.svelte';
	import MessageList from '$lib/components/MessageList.svelte';
	import MessageInput from '$lib/components/MessageInput.svelte';
	import NotificationModal from '$lib/components/NotificationModal.svelte';

	let conversations: ChatConversation[] = $state([]);
	let messages: Message[] = $state([]);
	let selectedConversation: ChatConversation | null = $state(null);
	let typingUsers = $state(new Set<string>());
	let loading = $state({ conversations: false, messages: false });
	let showNotificationModal = $state(false);
	let messageListComponent: MessageListHandle | null = $state(null);
	let accountGeneration = 0;
	let conversationGeneration = 0;
	let destroyed = false;
	let hasPreloadedMessages = false;
	let observedOwner: string | null = null;
	let historyCursor: string | undefined;
	let oldestMessageId: string | undefined;
	let hasEarlier = $state(false);
	let historySync: { selection: number; promise: Promise<boolean> } | undefined;
	const reading = new Set<string>();
	let unsubscribeOwner: (() => void) | undefined;
	let goSocket = $state.raw<ReturnType<typeof connectGoWebSocket>>();
	let goPresence = $state<{ peerId: string; online: boolean } | null>(null);
	const presencePeer = $derived.by(() => selectedConversation?.userId);

	$effect(() => {
		goPresence = null;
		goSocket?.watchPresence(presencePeer);
	});
	let goTypingExpiry: ReturnType<typeof setTimeout> | undefined;

	function owns(owner: string, generation: number) {
		return !destroyed && $user?._id === owner && generation === accountGeneration;
	}

	function clearSocket() {
		clearTimeout(goTypingExpiry);
		goSocket?.disconnect();
		goSocket = undefined;
	}

	onMount(() => {
		unsubscribeOwner = user.subscribe((account) => {
			const owner = account?._id ?? null;
			if (owner === observedOwner) return;
			observedOwner = owner;
			accountGeneration++;
			conversationGeneration++;
			conversations = [];
			messages = [];
			selectedConversation = null;
			resetHistory();
			typingUsers = new Set();
			hasPreloadedMessages = false;
			clearSocket();
			if (owner) void initializeAccount(owner, accountGeneration);
		});
		if (!$user)
			void authStore.init().then(() => {
				if (!$user && !destroyed) void goto('/login');
			});
	});

	onDestroy(() => {
		destroyed = true;
		accountGeneration++;
		conversationGeneration++;
		unsubscribeOwner?.();
		clearSocket();
	});

	async function initializeAccount(owner: string, generation: number) {
		if (!isSignalInitialized()) {
			try {
				const success = await initSignalWithRestore(
					owner,
					getOrCreateDeviceId(),
					API_BASE,
					undefined
				);
				if (!owns(owner, generation)) return;
				if (!success)
					toastStore.warning('Encryption keys not found. Please log out and log in again.');
			} catch (error) {
				if (!owns(owner, generation)) return;
				logger.error('[Chat] Signal Protocol initialization error:', error);
				toastStore.error('Failed to initialize encryption');
			}
		}
		if (!owns(owner, generation)) return;
		goSocket = connectGoWebSocket(owner, {
			onMessage: handleIncomingMessage,
			onReceipt: (peerId) => {
				if (owns(owner, generation) && selectedConversation?.userId === peerId) {
					void refreshHistory(peerId, owner, generation, conversationGeneration).catch((error) =>
						logger.error('[Chat] Receipt history failed:', error)
					);
				}
			},
			onReady: () => {
				if (!owns(owner, generation)) return;
				void chatService.flushNotifications(owner).catch(() => {});
				void catchUp(owner, generation);
			},
			onPresence: (peerId, online) => {
				if (owns(owner, generation) && selectedConversation?.userId === peerId) {
					goPresence = online === null ? null : { peerId, online };
				}
			},
			onTyping: handlePilotTyping
		});
		void chatService.flushNotifications(owner).catch(() => {});
		await loadConversations();
		if (owns(owner, generation)) await notificationStore.fetch();
	}

	async function loadConversations() {
		const owner = $user?._id;
		const generation = accountGeneration;
		if (!owner || destroyed) return;
		loading.conversations = true;
		try {
			const loaded = await chatService.getConversations(owner);
			if (!owns(owner, generation)) return;
			conversations = loaded.map((conversation) => {
				const previous = conversations.find((c) => c.userId === conversation.userId);
				return {
					...conversation,
					unreadCount: Number(conversation.unreadCount || 0),
					online: previous?.online,
					lastSeen: previous?.lastSeen
				};
			});
			if (!hasPreloadedMessages && conversations.length) {
				hasPreloadedMessages = true;
				void Promise.all(
					conversations.map((conversation) =>
						chatService.getMessages(conversation.userId, 1, 0, owner).catch(() => {})
					)
				).then(() => {
					if (owns(owner, generation)) void loadConversations();
				});
			}
		} catch (error) {
			if (owns(owner, generation))
				toastStore.error(error instanceof Error ? error.message : 'Failed to load conversations');
		} finally {
			if (owns(owner, generation)) loading.conversations = false;
		}
	}

	async function refreshHistory(
		userId: string,
		owner: string,
		generation: number,
		selection: number
	) {
		const history = await chatService.getMessages(userId, 50, 0, owner);
		if (!owns(owner, generation) || selection !== conversationGeneration) return false;
		messages = mergeMessages(messages, history);
		return true;
	}

	function resetHistory() {
		historyCursor = undefined;
		oldestMessageId = undefined;
		hasEarlier = false;
		reading.clear();
	}

	async function syncHistory(userId: string, owner: string, generation: number, selection: number) {
		const isCurrent = () => owns(owner, generation) && selection === conversationGeneration;
		while (historySync?.selection === selection) await historySync.promise.catch(() => {});
		if (!isCurrent()) return false;
		const promise = (async () => {
			let more = true;
			do {
				const cursor = historyCursor;
				const page = await chatService.getMessagesPage(
					userId,
					50,
					0,
					owner,
					cursor ? { afterMessageId: cursor } : undefined
				);
				if (!isCurrent()) return false;
				messages = mergeMessages(messages, page.messages);
				if (page.cached) return true;
				if (!cursor) hasEarlier = page.hasMore;
				oldestMessageId ??= page.firstId;
				historyCursor = page.lastId ?? cursor ?? 'start';
				more =
					cursor !== undefined &&
					page.hasMore &&
					page.lastId !== undefined &&
					page.lastId !== cursor;
			} while (more);
			return true;
		})();
		historySync = { selection, promise };
		try {
			return await promise;
		} finally {
			if (historySync?.promise === promise) historySync = undefined;
		}
	}

	async function loadEarlier() {
		const owner = $user?._id;
		const peer = selectedConversation?.userId;
		const generation = accountGeneration;
		const selection = conversationGeneration;
		if (!owner || !peer || !oldestMessageId) return;
		try {
			const page = await chatService.getMessagesPage(peer, 50, 0, owner, {
				beforeMessageId: oldestMessageId
			});
			if (!owns(owner, generation) || selection !== conversationGeneration) return;
			messages = mergeMessages(page.messages, messages);
			oldestMessageId = page.firstId ?? oldestMessageId;
			hasEarlier = page.hasMore;
		} catch {
			if (owns(owner, generation) && selection === conversationGeneration)
				toastStore.error('Could not load earlier messages. Try again.');
		}
	}

	async function readVisible(ids: string[]) {
		const owner = $user?._id;
		const peer = selectedConversation?.userId;
		const generation = accountGeneration;
		const selection = conversationGeneration;
		if (!owner || !peer) return;
		const visible = new Set(ids);
		const batch = messages
			.filter(
				(message) =>
					visible.has(message._id) &&
					!reading.has(message._id) &&
					message.senderId === peer &&
					message.receiverId === owner &&
					!message.read
			)
			.slice(0, 50);
		if (!batch.length) return;
		const requested = new Set(batch.map((message) => message._id));
		for (const id of requested) reading.add(id);
		try {
			await chatService.markAsRead(peer, owner, [...requested]);
			if (!owns(owner, generation) || selection !== conversationGeneration) return;
			messages = messages.map((message) =>
				requested.has(message._id) ? { ...message, read: true, status: 'read' } : message
			);
			conversations = conversations.map((conversation) =>
				conversation.userId === peer
					? {
							...conversation,
							unreadCount: Math.max(0, Number(conversation.unreadCount ?? 0) - requested.size)
						}
					: conversation
			);
		} catch (error) {
			if (owns(owner, generation)) logger.warning('[Chat] Read receipt failed', error);
		} finally {
			if (owns(owner, generation) && selection === conversationGeneration)
				for (const id of requested) reading.delete(id);
		}
	}

	async function catchUp(owner: string, generation: number) {
		if (!owns(owner, generation)) return;
		const userId = selectedConversation?.userId;
		const selection = conversationGeneration;
		try {
			if (userId) {
				if (!(await syncHistory(userId, owner, generation, selection))) return;
				if (!owns(owner, generation) || selection !== conversationGeneration) return;
			}
			await loadConversations();
		} catch (error) {
			if (owns(owner, generation)) logger.error('[Chat] Reconnect history failed:', error);
		}
	}

	async function selectConversation(userId: string) {
		const conversation = conversations.find((c) => c.userId === userId);
		const owner = $user?._id;
		if (!conversation || !owner) return;
		const generation = accountGeneration;
		const selection = ++conversationGeneration;
		selectedConversation = conversation;
		messages = [];
		resetHistory();
		loading.messages = true;
		try {
			if (!(await syncHistory(userId, owner, generation, selection))) return;
			if (!owns(owner, generation) || selection !== conversationGeneration) return;
			await loadConversations();
			if (!owns(owner, generation) || selection !== conversationGeneration) return;
			selectedConversation = conversations.find((c) => c.userId === userId) ?? conversation;
		} catch (error) {
			if (owns(owner, generation) && selection === conversationGeneration)
				toastStore.error(error instanceof Error ? error.message : 'Failed to load messages');
		} finally {
			if (owns(owner, generation) && selection === conversationGeneration) loading.messages = false;
		}
	}

	async function sendMessage(content: string): Promise<boolean> {
		if (!selectedConversation || !$user) return false;
		const sanitizedContent = sanitizeMessage(content);
		if (!sanitizedContent) {
			toastStore.error('Invalid message content');
			return false;
		}
		const recipient = selectedConversation;
		const owner = $user._id;
		const generation = accountGeneration;
		const selection = conversationGeneration;
		try {
			const pending = await chatService.prepareMessage(
				{ receiverId: recipient.userId, content: sanitizedContent },
				owner,
				recipient.username
			);
			if (!owns(owner, generation)) return false;
			if (selection === conversationGeneration) messages = mergeMessages(messages, [pending]);
			if (!conversations.some((c) => c.userId === recipient.userId))
				conversations = [...conversations, recipient];
			conversations = conversations.map((c) =>
				c.userId === recipient.userId
					? { ...c, lastMessage: sanitizedContent, lastMessageTime: pending.timestamp }
					: c
			);
			void transmitMessage(pending, owner, generation, selection);
			return true;
		} catch (error) {
			if (owns(owner, generation))
				toastStore.error(error instanceof Error ? error.message : 'Failed to prepare message');
			return false;
		}
	}

	async function transmitMessage(
		message: Message,
		owner: string,
		generation: number,
		selection: number
	) {
		try {
			const result = await chatService.retryMessage(message.clientMessageId ?? message._id, owner);
			if (owns(owner, generation) && selection === conversationGeneration) {
				messages = mergeMessages(messages, [result]);
				if (result.sendState === 'accepted') goSocket?.refreshPresence();
			}
		} catch (error) {
			if (owns(owner, generation) && selection === conversationGeneration) {
				messages = messages.map((row) =>
					row._id === message._id ? { ...row, sendState: 'failed', retryable: true } : row
				);
				toastStore.error(error instanceof Error ? error.message : 'Failed to send message');
			}
		}
	}

	function retryMessage(message: Message) {
		if (!$user || message.senderId !== $user._id || !message.retryable) return;
		messages = messages.map((row) =>
			row._id === message._id ? { ...row, sendState: 'pending' } : row
		);
		void transmitMessage(message, $user._id, accountGeneration, conversationGeneration);
	}

	async function handleIncomingMessage(incoming: Message) {
		const owner = $user?._id;
		const generation = accountGeneration;
		if (!owner) return;
		try {
			const result = await chatService.receiveMessage(incoming, owner);
			if (!owns(owner, generation)) return;
			const message = result.message;
			const other = message.senderId === owner ? message.receiverId : message.senderId;
			if (selectedConversation?.userId === other) {
				messages = mergeMessages(messages, [message]);
				goSocket?.refreshPresence();
			}
			if (message.senderId !== owner) {
				void chatService.acknowledgeDelivery(message._id, owner).catch((error) => {
					if (owns(owner, generation))
						logger.error('[Chat] Delivery acknowledgement failed:', error);
				});
			}
			if (!result.fresh) return;
			const conversation = conversations.find((c) => c.userId === other) ?? {
				userId: other,
				username: message.senderUsername || 'User',
				unreadCount: 0
			};
			const updated = {
				...conversation,
				lastMessage: message.content,
				lastMessageTime: message.timestamp,
				unreadCount:
					message.senderId !== owner && !message.read
						? Number(conversation.unreadCount || 0) + 1
						: conversation.unreadCount
			};
			conversations = [...conversations.filter((c) => c.userId !== other), updated];
			if (message.senderId !== owner)
				toastStore.info('New message from ' + (message.senderUsername || 'User'));
		} catch (error) {
			if (owns(owner, generation)) logger.error('[Chat] Incoming message failed:', error);
		}
	}

	function handleTypingIndicator(userId: string, isTyping: boolean) {
		if (isTyping) typingUsers.add(userId);
		else typingUsers.delete(userId);
		typingUsers = new Set(typingUsers);
	}
	function handlePilotTyping(peerId: string, isTyping: boolean) {
		if (selectedConversation?.userId !== peerId) return;
		clearTimeout(goTypingExpiry);
		handleTypingIndicator(peerId, isTyping);
		if (isTyping) goTypingExpiry = setTimeout(() => handleTypingIndicator(peerId, false), 3000);
	}
	function handleTyping(isTyping: boolean) {
		const peer = selectedConversation?.userId;
		if (!peer) return;
		goSocket?.sendTyping(peer, isTyping);
	}
	function handleBack() {
		if (goSocket) {
			handleTyping(false);
			clearTimeout(goTypingExpiry);
			typingUsers = new Set();
		}
		conversationGeneration++;
		selectedConversation = null;
		messages = [];
		resetHistory();
	}
	async function createConversation(value: unknown) {
		const account = value as Record<string, unknown>;
		const userId = String(account.userId ?? '');
		if (!userId) return;
		if (!conversations.some((c) => c.userId === userId)) {
			conversations = [...conversations, { userId, username: String(account.username ?? '') }];
		}
		await selectConversation(userId);
	}
	function handleLogout() {
		void authStore.logout();
	}
	function toggleNotificationModal() {
		showNotificationModal = !showNotificationModal;
		if (showNotificationModal) void notificationStore.fetch();
	}
</script>

<svelte:head>
	<title>Secret · {$user?.username || 'User'}</title>
</svelte:head>

<div class="flex h-dvh flex-col" style="background: var(--bg-primary);">
	<!-- Modern Top Navigation with Glass Effect -->
	<nav class="glass-strong border-b" style="border-color: var(--border-subtle);">
		<div class="flex items-center justify-between px-6 py-4">
			<div class="flex items-center gap-4">
				<!-- Mobile: conversations are shown as the default initial view (no sidebar toggle) -->
				<div class="flex items-center gap-3">
					<Seal size={40} />
					<div>
						<h1
							class="text-lg font-semibold"
							style="color: var(--text-primary); font-family: var(--font-serif);"
						>
							Secret
						</h1>
						<p class="text-xs" style="color: var(--text-tertiary);">Sealed end-to-end</p>
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
							class="animate-scale-in absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold"
							style="background: var(--accent-primary); color: var(--accent-contrast); box-shadow: var(--shadow-cta);"
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

	<!-- Main Chat Interface with Modern Design (sidebar removed) -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Primary area: conversation list is the default initial view (full-width). On select, show chat thread. -->
		<div class="flex flex-1 flex-col" style="background: var(--bg-primary);">
			{#if selectedConversation}
				<ChatHeader
					recipient={selectedConversation}
					presence={goSocket
						? goPresence?.peerId === selectedConversation.userId
							? goPresence.online
							: null
						: undefined}
					isTyping={typingUsers.has(selectedConversation.userId)}
					back={handleBack}
				/>
				<MessageList
					bind:this={messageListComponent}
					{messages}
					currentUserId={$user?._id || ''}
					loading={loading.messages}
					conversationId={selectedConversation.userId}
					{typingUsers}
					typingUsername={selectedConversation.username}
					retry={retryMessage}
					{hasEarlier}
					{loadEarlier}
					{readVisible}
				/>
				<MessageInput send={sendMessage} typing={handleTyping} disabled={!$user} />
			{:else}
				<!-- Conversation list (full-width) as the default first interaction screen -->
				<div class="w-full flex-1">
					<ChatList
						{conversations}
						selectedUserId={selectedConversation
							? (selectedConversation as ChatConversation).userId
							: null}
						currentUserId={$user?._id || null}
						loading={loading.conversations}
						onSelect={selectConversation}
						onCreate={createConversation}
					/>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Notification Modal -->
<NotificationModal isOpen={showNotificationModal} onClose={() => (showNotificationModal = false)} />
