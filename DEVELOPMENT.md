# Chat Application - Development Guide

## 🤖 Development Philosophy

This project follows a **hybrid AI-assisted development approach** where human expertise and AI capabilities work in synergy:

### Division of Labor

**👨‍💻 Developer's Primary Role:**
- **System Architecture Design**: Designing the overall application architecture, component hierarchy, and data flow patterns
- **Code Review & Guidance**: Ensuring AI-generated code follows best practices, security standards, and performance optimization
- **Strategic Direction**: Defining feature requirements, user experience goals, and technical roadmap
- **Quality Assurance**: Validating implementations meet production standards and business requirements

**🤖 AI's Primary Role:**
- **Code Scaffolding**: Generating components, services, stores, and TypeScript types
- **Code Integration**: Integrating complex libraries (Signal Protocol, Socket.IO, WebSocket management)
- **Local Deployment**: Setting up development environments, build pipelines, and testing frameworks
- **Troubleshooting**: Debugging issues, analyzing error logs, and implementing fixes
- **Documentation**: Creating detailed documentation and developer guides

### Best Practices Guidance

The AI is guided by the developer to follow:
- Modern Svelte/SvelteKit patterns and reactive programming
- Type-safe development with TypeScript strict mode
- Security-first approach (E2EE, authentication, XSS prevention)
- Clean code principles and component modularity
- Comprehensive testing strategies
- Responsive design and accessibility compliance

This **collaborative methodology** leverages the **developer's architectural vision and domain expertise** alongside the **AI's rapid implementation and integration capabilities**, achieving accelerated development while maintaining enterprise-grade quality and security.

---

## 🎉 Project Overview

Full-featured **real-time chat application** with **end-to-end encryption** built using SvelteKit, TypeScript, and Tailwind CSS. Connects to microservices backend via nginx reverse proxy on port 85.

### ✨ Features Implemented

✅ **End-to-End Encryption (E2EE)**

- Signal Protocol implementation with X3DH and Double Ratchet
- **Client-side AES-256-GCM key encryption** before backend storage
- **PBKDF2 (100k iterations)** for password-based key derivation
- Automatic prekey bundle generation and publishing
- IndexedDB-based key storage with device isolation
- Secure session establishment with prekey bundles
- **Server never sees plaintext keys** - zero-knowledge architecture
- Device-specific encrypted backups with rate limiting

✅ **Authentication**

- User registration and login
- JWT token management with httpOnly cookies
- Protected routes with auth guards
- Auto-redirect based on authentication status
- Device ID management for E2EE

✅ **Real-time Chat**

- WebSocket connections via Socket.IO
- Instant message delivery
- Typing indicators
- Connection status monitoring
- Auto-reconnection logic
- Message history with encryption/decryption

✅ **Notifications**

- Toast notifications for user feedback
- Notification center integration
- Unread count tracking
- Real-time notification delivery

✅ **Modern UI**

- Responsive design (mobile & desktop)
- Tailwind CSS v4 styling
- Theme toggle (dark/light mode)
- Loading states and error handling
- Smooth animations and transitions

---

## 📁 Project Structure

```
src/
├── lib/
│   ├── components/          # Reusable Svelte components
│   │   ├── ChatHeader.svelte       # Conversation header with typing
│   │   ├── ChatList.svelte         # Conversations sidebar
│   │   ├── MessageInput.svelte     # Message input with send
│   │   ├── MessageList.svelte      # Message display with scrolling
│   │   ├── NotificationModal.svelte # Notification center
│   │   ├── ThemeToggle.svelte      # Dark/light theme toggle
│   │   └── Toast.svelte            # Toast notifications
│   │
│   ├── crypto/              # End-to-end encryption
│   │   ├── signal.ts               # Signal Protocol (X3DH, Double Ratchet)
│   │   ├── keyEncryption.ts        # Client-side key encryption (NEW)
│   │   └── types.ts                # Crypto type definitions
│   │
│   ├── services/            # API and WebSocket services
│   │   ├── api.ts                  # Base API client with auth
│   │   ├── auth.service.ts         # Authentication API
│   │   ├── chat.service.ts         # Chat/messaging with E2EE
│   │   ├── notification.service.ts # Notifications API
│   │   └── websocket.service.ts    # WebSocket manager
│   │
│   ├── stores/              # Svelte stores for state management
│   │   ├── auth.store.ts           # Auth state & user data
│   │   ├── chat.store.ts           # Conversations & messages
│   │   ├── notification.store.ts   # Notifications
│   │   ├── theme.store.ts          # Theme preferences
│   │   └── toast.store.ts          # Toast messages
│   │
│   ├── types/               # TypeScript type definitions
│   │   └── index.ts                # All app types
│   │
│   └── utils/               # Utility functions
│       ├── debounce.ts             # Debounce helper
│       ├── normalizeNotification.ts # Notification normalization
│       └── sanitize.ts             # HTML sanitization
│
└── routes/                  # SvelteKit pages
    ├── +layout.svelte              # Root layout with Toast
    ├── +page.svelte                # Home (redirects)
    ├── login/+page.svelte          # Login page with E2EE setup
    ├── register/+page.svelte       # Registration with key generation
    └── chat/+page.svelte           # Main chat interface
```

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Default configuration for local development:

```env
PUBLIC_API_URL=http://localhost:85
PUBLIC_WS_URL=http://localhost:85
PUBLIC_APP_NAME="Chat App"
PUBLIC_APP_VERSION=0.0.1
```

**Backend Connection:**

- **Nginx (port 85)**: All API and WebSocket requests
- Nginx proxies to user-service (8081), chat-service (8082), notification-service (8083)
- Consistent origin for httpOnly cookie authentication

### 3. Start Backend Services

Ensure backend is running:

```bash
cd ../chat-microservices
docker-compose up -d --build
```

Verify backend health:

```bash
curl http://localhost:85/api/user/health
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

### End-to-End Encryption (E2EE)

**Implementation**: Signal Protocol via `@privacyresearch/libsignal-protocol-typescript`

**Security Architecture:**

- **Client-side encryption**: Messages encrypted before sending to server
- **Zero-knowledge backend**: Server stores encrypted key bundles, never sees plaintext
- **AES-256-GCM encryption**: Client-side key encryption with authenticated encryption
- **PBKDF2 key derivation**: 100,000 iterations (OWASP compliant)
- **Device isolation**: Each device has separate encrypted key backup
- **Rate limiting**: 1 key backup per 24 hours to prevent abuse
- **Audit logging**: All key operations logged for security monitoring

**Key Features:**

- **Automatic setup**: Prekey bundles generated and published on registration/login
- **Device ID management**: Each browser/device gets unique encryption keys
- **Session establishment**: Automatic X3DH key exchange when messaging new contacts
- **IndexedDB storage**: Keys stored locally with device-specific database
- **Encrypted backups**: Optional password-protected cloud backup (currently disabled)

**Flow:**

1. **Registration/Login**: Generate identity keypair and prekey bundles
2. **Publish keys**: Upload public keys to server for others to fetch
3. **Key backup** (if password provided): Encrypt keys client-side, store on server
4. **Send message**: Fetch recipient's prekey bundle, establish session, encrypt message
4. **Receive message**: Decrypt using stored session keys
5. **History**: Messages are decrypted when fetching conversation history

**Files:**

- `src/lib/crypto/signal.ts` — Signal Protocol wrapper
- `src/lib/services/chat.service.ts` — E2EE integration in messaging

### Authentication Flow

1. User visits root (`/`)
2. App checks authentication via httpOnly cookie
3. If authenticated → redirect to `/chat` (with E2EE setup)
4. If not → redirect to `/login`

**Login/Register Pages:**

- Client-side form validation
- Server-side validation feedback
- Error handling with toast notifications
- Loading states during API calls
- Auto-redirect on successful authentication
- JWT token in httpOnly cookie (backend-managed)
- **E2EE initialization**: Generate and publish encryption keys

### Chat Interface (`/chat`)

**Main features:**

- **Sidebar**: Conversations list with unread badges
- **Header**: Current conversation info, typing indicator
- **Messages**: Scrollable history with automatic decryption
- **Input**: Message compose with Enter to send, Shift+Enter for newline
- **Encryption**: All messages encrypted before sending

**Real-time features:**

- WebSocket connection for instant messages
- Automatic message decryption on receipt
- Typing indicators
- Auto-scroll to bottom
- Connection status notifications

### WebSocket Service

Manages real-time communication via Socket.IO:

- Auto-connect on successful authentication
- Authentication via httpOnly cookie
- Auto-reconnect on disconnect (5 attempts, 3s delay)
- Real-time encrypted message delivery
- Automatic decryption of incoming messages
- Typing indicators
- Connection status monitoring
- Graceful cleanup on logout

### State Management

**Stores:**

- `authStore`: User authentication state, device ID
- `chatStore`: Conversations and decrypted messages
- `notificationStore`: Notifications and unread count
- `toastStore`: Toast messages for user feedback
- `themeStore`: Dark/light mode preference

---

## 📡 API Integration

### Backend Services

| Service              | Port | Endpoint Prefix  | Purpose                       |
| -------------------- | ---- | ---------------- | ----------------------------- |
| User Service         | 8081 | `/user`          | Auth, registration, profiles  |
| Chat Service         | 8082 | `/chat`          | Messages, conversations       |
| Notification Service | 8083 | `/notifications` | Notifications                 |
| Nginx Proxy          | 85   | `/*`             | Reverse proxy to all services |

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
