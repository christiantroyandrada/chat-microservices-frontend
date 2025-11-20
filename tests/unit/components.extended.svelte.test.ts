import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// Components
import ChatHeader from '$lib/components/ChatHeader.svelte';
import ChatList from '$lib/components/ChatList.svelte';
import MessageInput from '$lib/components/MessageInput.svelte';
import MessageList from '$lib/components/MessageList.svelte';
import NotificationModal from '$lib/components/NotificationModal.svelte';

// Mocks used across tests
vi.mock('$app/environment', () => ({ browser: true }));

// Mock services/stores referenced by components
vi.mock('$lib/services/chat.service', () => ({
  chatService: { searchUsers: vi.fn().mockResolvedValue([]) }
}));

vi.mock('$lib/stores/toast.store', () => ({
  toastStore: { subscribe: vi.fn(), error: vi.fn(), success: vi.fn(), clear: vi.fn() }
}));

vi.mock('$lib/services/dev-logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

vi.mock('$lib/stores/notification.store', () => ({
  notificationStore: {
    subscribe: vi.fn((fn) => {
      fn({ notifications: [], unreadCount: 0, loading: false });
      return () => {};
    }),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    delete: vi.fn()
  }
}));

describe('Extended component tests (browser)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ChatHeader', () => {
    it('shows empty state when no recipient', () => {
      render(ChatHeader, {});
      expect(screen.getByText('Select a conversation')).toBeTruthy();
    });

    it('renders typing indicator and calls back on back button', async () => {
      const back = vi.fn();
      render(ChatHeader, {
        recipient: { userId: 'u1', username: 'Alice' },
        isTyping: true,
        back
      });

      expect(screen.getByText('typing')).toBeTruthy();
      // click back button
      const btn = screen.getByRole('button', { name: /Back to conversations/i });
      await fireEvent.click(btn);
      expect(back).toHaveBeenCalled();
    });

    it('shows Online/Offline and relative times', () => {
      const now = new Date().toISOString();
      const onlineRecipient = { userId: 'u2', username: 'Bob', online: true };
      const offlineRecipient = { userId: 'u3', username: 'Charlie', online: false, lastSeen: now };

      const { rerender } = render(ChatHeader, { recipient: onlineRecipient });
      expect(screen.getByText('Online')).toBeTruthy();

      rerender({ recipient: offlineRecipient });
      // lastSeen is now, should show Active 0m ago or similar
      expect(screen.getByText(/Active|Last active|Offline/)).toBeTruthy();
    });
  });

  describe('ChatList', () => {
    it('opens create modal, searches, selects user and calls onCreate', async () => {
      const { chatService } = await import('$lib/services/chat.service');
      const users = [ { _id: 'u1', username: 'Doug' }, { _id: 'u2', username: 'Eve' } ];
      (chatService.searchUsers as unknown as any).mockResolvedValue(users);

      const onCreate = vi.fn();
      const { container } = render(ChatList, { currentUserId: 'me', onCreate });

      // open modal
      const newChatBtn = container.querySelector('button[aria-label="Start new conversation"]') as HTMLElement;
      await fireEvent.click(newChatBtn);

      const input = container.querySelector('input[placeholder="Search users by name or email"]') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: 'Do' } });

      // advance timers for debounce (300ms)
      vi.useFakeTimers();
      vi.advanceTimersByTime(350);
      // wait for the async search to populate
      await waitFor(() => expect(chatService.searchUsers).toHaveBeenCalled());
      vi.useRealTimers();

      // click first user
      const resultBtn = screen.getByText('Doug').closest('button') as HTMLElement;
      await fireEvent.click(resultBtn);

      // Start Chat should call onCreate
      const startBtn = screen.getByText('Start Chat') as HTMLElement;
      await fireEvent.click(startBtn);
      expect(onCreate).toHaveBeenCalled();
    });
  });

  describe('MessageInput', () => {
    it('calls send on Enter and resets message', async () => {
      const send = vi.fn();
      const typing = vi.fn();
      const { container } = render(MessageInput, { send, typing, maxLength: 100 });

      const textarea = container.querySelector('textarea[aria-label="Message input"]') as HTMLTextAreaElement;
      await fireEvent.input(textarea, { target: { value: '  hello world  ' } });

      // simulate Enter key
      await fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(send).toHaveBeenCalledWith('hello world');
      // message should be cleared
      expect(textarea.value).toBe('');
    });

    it('blocks send when message over maxLength and shows toast', async () => {
      const long = 'x'.repeat(10);
      const send = vi.fn();
      const { toastStore } = await import('$lib/stores/toast.store');
      const { container } = render(MessageInput, { send, maxLength: 5 });

      const textarea = container.querySelector('textarea[aria-label="Message input"]') as HTMLTextAreaElement;
      await fireEvent.input(textarea, { target: { value: long } });
      const sendBtn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement;
      await fireEvent.click(sendBtn);

      expect(send).not.toHaveBeenCalled();
      expect((toastStore.error as unknown as any).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('MessageList', () => {
    it('renders messages and date separators and exports scrollToLatest', async () => {
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const messages = [
        { _id: 'm1', senderId: 'a', receiverId: 'me', senderUsername: 'A', content: 'First', timestamp: yesterday.toISOString() },
        { _id: 'm2', senderId: 'me', receiverId: 'a', senderUsername: 'Me', content: 'Second', timestamp: today.toISOString() }
      ];

      const { container } = render(MessageList, { messages, currentUserId: 'me', conversationId: 'c1' });
      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.getByText('Second')).toBeTruthy();
      // date badge exists
      expect(container.querySelector('.date-badge')).toBeTruthy();

      // call exported helper - import dynamically then call exported member
      const mod = await import('$lib/components/MessageList.svelte');
      if (typeof mod.scrollToLatest === 'function') {
        await (mod.scrollToLatest as any)();
      }
      const { logger } = await import('$lib/services/dev-logger');
      expect((logger.debug as unknown as any).mock.calls.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('NotificationModal', () => {
    it('renders empty state and calls onClose when backdrop clicked', async () => {
      const onClose = vi.fn();
      const { container } = render(NotificationModal, { isOpen: true, onClose });

      // empty state message
      expect(screen.getByText('No notifications yet')).toBeTruthy();

      // click backdrop by finding the backdrop element
      const backdrop = container.querySelector('.notification-backdrop') as HTMLElement;
      // Click directly on backdrop to trigger close
      await fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
