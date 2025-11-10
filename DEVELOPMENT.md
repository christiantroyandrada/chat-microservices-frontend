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

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

Default configuration:

```env
PUBLIC_API_URL=http://localhost:85
PUBLIC_WS_URL=http://localhost:85
PUBLIC_APP_NAME="Chat App"
PUBLIC_APP_VERSION=0.0.1
```

**Backend Connection:**

- **Nginx (port 85)**: Recommended for development (proxies all services)
- All API and WebSocket requests route through nginx for consistent origin handling

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
curl http://localhost:85/user/health
```

### 4. Start Frontend

```bash
pnpm dev
```

Open browser at: **http://localhost:5173**

---

## 🔧 Development Workflow

### Running the App

1. **Start backend services** (ports 8081-8083 via Docker)
2. **Start nginx** (port 85 via Docker)
3. **Start frontend** (`pnpm dev` on port 5173)
4. **Register a new account** at `http://localhost:5173/register`
5. **Login and start chatting** at `http://localhost:5173/chat`

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
2. App checks authentication status via httpOnly cookie
3. If authenticated → redirect to `/chat`
4. If not → redirect to `/login`

**Login/Register Pages:**

- Client-side form validation
- Server-side validation feedback
- Error handling with toast notifications
- Loading states during API calls
- Auto-redirect on successful authentication
- JWT token stored in httpOnly cookie (managed by backend)

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

Manages real-time communication via Socket.IO:

- Auto-connect on successful authentication
- Authentication via httpOnly cookie (sent automatically with handshake)
- Auto-reconnect on disconnect (5 attempts with 3s delay)
- Real-time message delivery
- Typing indicators
- Connection status monitoring (connected/disconnected/reconnecting)
- Graceful cleanup on logout/unmount

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
| User Service         | 8081 | `/user`              | Auth, registration, profiles |
| Chat Service         | 8082 | `/chat`              | Messages, conversations      |
| Notification Service | 8083 | `/notifications`     | Notifications                |
| Nginx Proxy          | 85   | `/*`                 | Reverse proxy to all services|

**Note:** All services are accessed through nginx on port 85. Direct service access is not exposed to frontend.

### API Endpoints Used

**Authentication:**

- `POST /user/register` - Register new user
- `POST /user/login` - Login user (sets httpOnly cookie)
- `POST /user/logout` - Logout user (clears httpOnly cookie)
- `GET /user/me` - Get current user profile
- `GET /user/search?q={query}` - Search users by name or email
- `GET /user/:id` - Get user by ID

**Chat:**

- `GET /chat/conversations` - Get all conversations with last message
- `GET /chat/messages/:userId` - Get message history with specific user
- `POST /chat/messages` - Send message via HTTP (also via WebSocket)
- `PUT /chat/messages/read/:senderId` - Mark messages as read

**Notifications:**

- `GET /notifications` - Get all notifications
- `GET /notifications/unread/count` - Get unread notification count
- `PUT /notifications/:id/read` - Mark notification as read
- `DELETE /notifications/:id` - Delete notification

**WebSocket Events (via Socket.IO):**

- `connect` - WebSocket connection established
- `disconnect` - WebSocket connection closed
- `sendMessage` - Send message in real-time
- `receiveMessage` - Receive incoming message
- `typing` - Send/receive typing indicators

---

## 🐛 Troubleshooting

### Backend Connection Issues

**Problem:** Cannot connect to API

**Solutions:**

1. Verify backend is running: `docker-compose ps`
2. Check health endpoint: `curl http://localhost:85/user/health`
3. Verify `.env` file has correct `PUBLIC_API_URL=http://localhost:85`
4. Check browser console for CORS errors
5. Ensure nginx container is healthy and routing requests correctly

### WebSocket Not Connecting

**Problem:** Real-time messages not working

**Solutions:**

1. Verify chat service is running: `docker-compose ps chat`
2. Check `PUBLIC_WS_URL=http://localhost:85` in `.env` (must match API URL)
3. Ensure nginx is routing `/chat/socket.io/` correctly
4. Open browser DevTools → Network → WS tab to inspect connection
5. Check for WebSocket upgrade errors in nginx logs
6. Verify httpOnly cookie is present in Application → Cookies (DevTools)

### Authentication Failing

**Problem:** Login/register not working

**Solutions:**

1. Verify user service is running: `docker-compose ps user`
2. Check PostgreSQL database is healthy: `docker-compose ps postgres`
3. Ensure `PUBLIC_API_URL` matches nginx origin for httpOnly cookies
4. Clear browser cookies (Application → Cookies in DevTools)
5. Check browser console for 401/403 errors
6. Verify JWT_SECRET is configured in backend services
7. Try incognito/private window to rule out cookie conflicts

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

### Current Implementation

- **JWT Storage**: Tokens stored in httpOnly cookies (set by backend)
- **Authentication**: Automatic cookie transmission with `credentials: 'include'`
- **WebSocket Auth**: Socket.IO handshake uses httpOnly cookie from headers
- **CORS**: Configured on backend services to allow credentials
- **Input Validation**: Client-side validation + server-side validation
- **XSS Prevention**: Svelte automatically escapes content
- **CSRF Protection**: SameSite cookie attribute (set by backend)

### Production Checklist

- [ ] Use HTTPS for all connections
- [ ] Use WSS (secure WebSocket) for real-time communication
- [ ] Implement token refresh mechanism
- [ ] Add rate limiting on API endpoints
- [ ] Enable Content Security Policy (CSP) headers
- [ ] Sanitize and validate all user inputs
- [ ] Use secure cookie settings (Secure, HttpOnly, SameSite)
- [ ] Implement proper error handling without exposing sensitive info
- [ ] Add security headers (X-Frame-Options, X-Content-Type-Options)
- [ ] Regular security audits and dependency updates

---

## 📝 Next Steps / Enhancements

### Potential Features

- [x] **User search** - Find and start conversations with new users
- [x] **Dark mode** - Theme switcher implemented
- [x] **Typing indicators** - Real-time typing status
- [x] **Read receipts** - Mark messages as read
- [ ] **File upload** - Send images and files
- [ ] **Message reactions** - React with emojis
- [ ] **User profiles** - View and edit user profiles
- [ ] **Group chats** - Multi-user conversations
- [ ] **Voice/video calls** - WebRTC integration
- [ ] **Message editing** - Edit sent messages
- [ ] **Message deletion** - Delete messages
- [ ] **Push notifications** - Browser push notifications
- [ ] **Email notifications** - Email alerts for offline messages

### Technical Improvements

- [x] Implement Svelte 5 runes API for reactive state
- [x] Add PostCSS nesting support
- [x] Implement proper WebSocket lifecycle management
- [x] Add connection status monitoring
- [ ] Add comprehensive tests (Vitest + Playwright)
- [ ] Implement pagination for message history
- [ ] Add message caching with IndexedDB
- [ ] Optimize WebSocket reconnection strategy
- [ ] Add service worker for offline support
- [ ] Implement virtual scrolling for large message lists
- [ ] Add skeleton loaders for better perceived performance
- [ ] Implement optimistic UI updates
- [ ] Add performance monitoring and analytics

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
