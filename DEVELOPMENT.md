# Chat Application - Development Guide

## 🎉 Project Overview

This is a full-featured **real-time chat application** built with SvelteKit, TypeScript, and Tailwind CSS. It connects to a microservices backend running on ports 8081-8083, proxied through nginx on port 85 or a gateway on port 8080.

### ✨ Features Implemented

✅ **Authentication**

- User registration and login
- JWT token management
- Protected routes
- Auto-redirect based on auth status

✅ **Real-time Chat**

- WebSocket connections for instant messaging
- Typing indicators
- Connection status monitoring
- Auto-reconnection logic
- Message history

✅ **Notifications**

- Toast notifications for user feedback
- Notification center integration
- Unread count tracking

✅ **Modern UI**

- Responsive design (mobile & desktop)
- Tailwind CSS styling
- Loading states
- Error handling

---

## 📁 Project Structure

```
src/
├── lib/
│   ├── components/          # Reusable Svelte components
│   │   ├── ChatHeader.svelte       # Chat conversation header
│   │   ├── ChatList.svelte         # Conversations sidebar
│   │   ├── MessageInput.svelte     # Message input with typing indicator
│   │   ├── MessageList.svelte      # Message display with scrolling
│   │   └── Toast.svelte            # Toast notifications
│   │
│   ├── services/            # API and WebSocket services
│   │   ├── api.ts                  # Base API client
│   │   ├── auth.service.ts         # Authentication API
│   │   ├── chat.service.ts         # Chat/messaging API
│   │   ├── notification.service.ts # Notifications API
│   │   └── websocket.service.ts    # WebSocket manager
│   │
│   ├── stores/              # Svelte stores for state management
│   │   ├── auth.store.ts           # Auth state & user data
│   │   ├── chat.store.ts           # Chat conversations & messages
│   │   ├── notification.store.ts   # Notifications
│   │   └── toast.store.ts          # Toast messages
│   │
│   └── types/               # TypeScript type definitions
│       └── index.ts                # All app types
│
└── routes/                  # SvelteKit pages
    ├── +layout.svelte              # Root layout with Toast
    ├── +page.svelte                # Home (redirects to login/chat)
    ├── login/+page.svelte          # Login page
    ├── register/+page.svelte       # Registration page
    └── chat/+page.svelte           # Main chat interface
```

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

The `.env` file is already created with default values:

```env
PUBLIC_API_URL=http://localhost:8080
PUBLIC_WS_URL=ws://localhost:8082
```

**Backend Connection Options:**

- **Gateway (port 8080)**: Recommended for development
- **Nginx (port 85)**: Alternative reverse proxy

### 3. Start Backend Services

Make sure your backend is running:

```bash
cd ../chat-microservices
docker-compose up -d --build

# Start gateway separately
cd gateway && npm run dev
```

Verify backend health:

```bash
curl http://localhost:85/api/health
# or
curl http://localhost:8080/api/health
```

### 4. Start Frontend

```bash
pnpm dev
```

Open browser at: **http://localhost:5173**

---

## 🔧 Development Workflow

### Running the App

1. **Start backend services** (ports 8081-8083)
2. **Start nginx** (port 85) or **gateway** (port 8080)
3. **Start frontend** (`pnpm dev`)
4. **Register a new account** at `/register`
5. **Start chatting!**

### Testing

```bash
# Unit tests (Vitest)
pnpm test:unit

# E2E tests (Playwright)
pnpm test:e2e

# All tests
pnpm test
```

### Code Quality

```bash
# Type checking
pnpm check

# Linting
pnpm lint

# Format code
pnpm format
```

---

## 🎨 Key Components

### Authentication Flow

1. User visits root (`/`)
2. App checks for stored JWT token
3. If authenticated → redirect to `/chat`
4. If not → redirect to `/login`

**Login/Register Pages:**

- Form validation
- Error handling
- Loading states
- Auto-redirect on success

### Chat Interface (`/chat`)

**Main features:**

- **Sidebar**: List of conversations with unread badges
- **Header**: Current conversation info, typing indicator
- **Messages**: Scrollable message history with date separators
- **Input**: Message compose with Enter to send, Shift+Enter for newline

**Real-time features:**

- WebSocket connection for instant messages
- Typing indicators
- Auto-scroll to bottom
- Connection status notifications

### WebSocket Service

Manages real-time communication:

- Auto-connect on login
- Auto-reconnect on disconnect (5 attempts)
- Message delivery
- Typing indicators
- Online/offline status

### State Management

**Stores:**

- `authStore`: User authentication state
- `chatStore`: Conversations and messages
- `notificationStore`: Notifications and unread count
- `toastStore`: Toast messages for feedback

---

## 📡 API Integration

### Backend Services

| Service              | Port | Endpoint Prefix      | Purpose                      |
| -------------------- | ---- | -------------------- | ---------------------------- |
| User Service         | 8081 | `/api/user`          | Auth, registration, profiles |
| Chat Service         | 8082 | `/api/chat`          | Messages, conversations      |
| Notification Service | 8083 | `/api/notifications` | Notifications                |
| Nginx Proxy          | 85   | `/api/*`             | Reverse proxy to services    |
| Gateway              | 8080 | `/api/*`             | Alternative gateway          |

### API Endpoints Used

**Authentication:**

- `POST /api/user/register` - Register new user
- `POST /api/user/login` - Login user
- `GET /api/user/me` - Get current user

**Chat:**

- `GET /api/chat/conversations` - Get all conversations
- `GET /api/chat/messages/:userId` - Get messages with user
- `POST /api/chat/messages` - Send message
- `PUT /api/chat/messages/read/:senderId` - Mark as read

**Notifications:**

- `GET /api/notifications` - Get notifications
- `GET /api/notifications/unread/count` - Get unread count
- `PUT /api/notifications/:id/read` - Mark as read

---

## 🐛 Troubleshooting

### Backend Connection Issues

**Problem:** Cannot connect to API

**Solutions:**

1. Verify backend is running: `docker-compose ps`
2. Check health endpoint: `curl http://localhost:85/api/health`
3. Verify `.env` file has correct API URL
4. Check browser console for CORS errors

### WebSocket Not Connecting

**Problem:** Real-time messages not working

**Solutions:**

1. Verify chat service is running on port 8082
2. Check `PUBLIC_WS_URL` in `.env`
3. Open browser DevTools → Network → WS tab
4. Look for WebSocket connection errors

### Authentication Failing

**Problem:** Login/register not working

**Solutions:**

1. Check backend user service on port 8081
2. Verify MongoDB is running
3. Ensure you're using the gateway origin (e.g. http://localhost:85) so the httpOnly cookie is sent
4. Clear site cookies or open a fresh private window and try again

### Build Errors

**Problem:** TypeScript/Lint errors

**Solutions:**

```bash
# Clear and reinstall
rm -rf node_modules .svelte-kit
pnpm install

# Type check
pnpm check

# Fix lint issues
pnpm format
```

---

## 🔒 Security Notes

- JWT tokens stored in localStorage
- Tokens sent via `Authorization: Bearer` header
- WebSocket auth via query parameter
- Input validation on forms
- CORS handled by backend
- JWT tokens are stored in httpOnly cookies (set by the backend)
- Requests should be made with credentials included (frontend is configured to send cookies)
- WebSocket auth is performed using the same httpOnly cookie on the Socket.IO handshake
- Input validation on forms
- CORS handled by backend

**Production Checklist:**

- [ ] Use HTTPS for all connections
- [ ] Use WSS for WebSocket
- [ ] Implement token refresh
- [ ] Add rate limiting
- [ ] Enable CSP headers
- [ ] Sanitize user inputs

---

## 📝 Next Steps / Enhancements

### Potential Features

- [ ] **User search** - Find and start conversations with new users
- [ ] **File upload** - Send images and files
- [ ] **Message reactions** - React with emojis
- [ ] **Read receipts** - Show when messages are read
- [ ] **User profiles** - View and edit profiles
- [ ] **Group chats** - Multi-user conversations
- [ ] **Voice/video calls** - WebRTC integration
- [ ] **Message editing** - Edit sent messages
- [ ] **Message deletion** - Delete messages
- [ ] **Dark mode** - Theme switcher
- [ ] **Push notifications** - Browser notifications
- [ ] **Email notifications** - Email alerts

### Technical Improvements

- [ ] Add tests (Vitest + Playwright)
- [ ] Implement pagination for messages
- [ ] Add message caching
- [ ] Optimize WebSocket reconnection
- [ ] Add service worker for offline support
- [ ] Implement virtual scrolling for large message lists
- [ ] Add skeleton loaders
- [ ] Implement optimistic UI updates

---

## 📚 Tech Stack

- **Framework**: SvelteKit 2.47.1
- **Language**: TypeScript 5.9.3
- **Styling**: Tailwind CSS 4.1.14
- **Testing**: Vitest 3.2.4 + Playwright 1.56.1
- **Package Manager**: pnpm

---

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linting
4. Submit a pull request

---

## 📄 License

Private and proprietary. All rights reserved.

---

**Happy Coding! 🚀**
