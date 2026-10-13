# Chat Application - Development Guide

This real-time chat application uses SvelteKit, TypeScript, and Tailwind CSS.
It connects to the backend microservices through an nginx reverse proxy.

The application uses end-to-end encryption (E2EE).
E2EE prevents the server from reading message content.

The feature and architecture descriptions below record the original development work.
Their counts and security claims are historical records, not current release approval.
Current hardening work remains incomplete.

---

<a id="-features-implemented"></a>
## Features Implemented

**End-to-End Encryption (E2EE):**

- The Signal Protocol uses X3DH key exchange and the Double Ratchet algorithm.
- The client encrypts keys with AES-256-GCM before backend storage.
- PBKDF2 uses 100k iterations for password-based key derivation.
- The client generates and publishes prekey bundles automatically.
- IndexedDB stores keys separately for each device.
- Prekey bundles establish secure sessions.
- The server never receives plaintext keys.
  This is a zero-knowledge architecture.
- Each device has encrypted backups with rate limiting.

**Authentication:**

- Users can register and log in.
- The application manages JSON Web Tokens (JWT) with httpOnly cookies.
- Authentication checks protect routes.
- The application redirects users automatically according to their authentication status.
- Device ID management supports E2EE.

**Real-time Chat:**

- Socket.IO provides WebSocket connections.
- The application delivers messages immediately.
- Typing indicators show user activity.
- The application monitors connection status.
- The application reconnects automatically.
- Message history supports encryption and decryption.

**Notifications:**

- Toast notifications give users feedback.
- The application includes a notification center.
- The application tracks unread notification counts.
- Notifications arrive in real time.

**User Interface:**

- The responsive layout supports mobile and desktop screens.
- Tailwind CSS v4 provides styles.
- Users can select dark or light mode.
- The interface shows loading states and handles errors.
- The interface includes smooth animations and transitions.

---

<a id="-project-structure"></a>
## Project Structure

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
│   ├── crypto/              # End-to-end encryption (MODULAR ARCHITECTURE)
│   │   ├── signal.ts               # Main facade & public API (388 lines)
│   │   ├── signalStore.ts          # IndexedDB storage layer (266 lines)
│   │   ├── signalSession.ts        # Session & encryption (257 lines)
│   │   ├── signalKeyManager.ts     # Key generation & management (232 lines)
│   │   ├── signalBackup.ts         # Backend sync & restore (126 lines)
│   │   ├── signalUtils.ts          # Data conversion utilities (53 lines)
│   │   ├── signalConstants.ts      # Configuration constants (25 lines)
│   │   ├── keyEncryption.ts        # Client-side key encryption (AES-256-GCM)
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

<a id="-quick-start"></a>
## Quick Start

### 1. Install Dependencies

Install the dependencies with the command below.

```bash
pnpm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

These values are the default configuration for local development.

```env
PUBLIC_API_URL=http://localhost:85
PUBLIC_WS_URL=http://localhost:85
PUBLIC_APP_NAME="Chat App"
PUBLIC_APP_VERSION=0.0.1
```

**Backend Connection:**

- Nginx receives all API and WebSocket requests on port 85.
- Nginx forwards requests to user-service (8081), chat-service (8082), and notification-service (8083).
- All requests use the same origin for httpOnly cookie authentication.

### 3. Start Backend Services

Start the backend services.

```bash
cd ../chat-microservices
docker-compose up -d --build
```

Do a check of the backend health.

```bash
curl http://localhost:85/api/user/health
```

### 4. Start Frontend

Start the frontend with the command below.

```bash
pnpm dev
```

Open **http://localhost:5173** in a browser.

---

<a id="-architecture-deep-dive-modular-signal-protocol"></a>
## Architecture Deep Dive: Modular Signal Protocol

### The Problem: God Object Anti-Pattern

The original Signal Protocol implementation used one file with 1,235 lines and 8+ responsibilities.
These responsibilities were:

- The file managed IndexedDB storage.
- The file generated and managed keys.
- The file established sessions.
- The file encrypted and decrypted messages.
- The file synchronized data with the backend.
- The file supplied utility functions.
- The file defined constants and configuration.
- The file managed global state.

The term "God Object" describes a component with many responsibilities.
The original record identified these problems:

- The code was difficult to understand.
- Closely connected responsibilities made tests difficult.
- Components could not be reused.
- Changes affected multiple responsibilities and could cause errors.

### The Solution: Decomposition Pattern

The recorded refactor divided the code into 7 modules.
Each module has one responsibility.

```
┌─────────────────────────────────────────────────────┐
│                    signal.ts                        │
│              (Public API Facade - 388 lines)        │
│  • Maintains backward compatibility                 │
│  • Orchestrates module interactions                 │
│  • Manages global state                             │
└─────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│signalSession │  │signalKeyMgr  │  │signalBackup  │
│  (257 lines) │  │  (232 lines) │  │  (126 lines) │
│              │  │              │  │              │
│ • Encrypt    │  │ • Generate   │  │ • Export     │
│ • Decrypt    │  │ • Import     │  │ • Restore    │
│ • Sessions   │  │ • Publish    │  │ • Sync       │
└──────────────┘  └──────────────┘  └──────────────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                          ▼
              ┌──────────────────────┐
              │   signalStore.ts     │
              │  (IndexedDB - 266)   │
              │                      │
              │  • Identity Keys     │
              │  • Prekeys           │
              │  • Sessions          │
              └──────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
┌──────────────────┐          ┌──────────────────┐
│  signalUtils.ts  │          │signalConstants.ts│
│    (53 lines)    │          │    (25 lines)    │
│                  │          │                  │
│ • ArrayBuffer    │          │ • DEFAULT_*      │
│   conversions    │          │ • CONFIG values  │
│ • base64 encode  │          │                  │
└──────────────────┘          └──────────────────┘
```

### Module Responsibilities

#### 1. `signal.ts` (388 lines) - Public API Facade

This module preserves compatibility with earlier callers and coordinates the other modules.
A facade is a common public interface for those modules.

```typescript
// Same public API as before!
import { initSignal, encryptMessage } from '$lib/crypto/signal';

await initSignal(userId);
const encrypted = await encryptMessage(recipientId, plaintext);
```

**Key Functions:**

- `initSignal()` initializes the store for a user.
- `generateSignalIdentity()` generates a complete identity.
- `createSessionWithPrekeyBundle()` establishes a session.
- `encryptMessage()` and `decryptMessage()` encrypt and decrypt messages.
- `initSignalWithRestore()` restores data from the backend automatically.

#### 2. `signalStore.ts` (266 lines) - IndexedDB Storage

This module stores keys and sessions persistently in IndexedDB.

```typescript
import { IndexedDBSignalProtocolStore } from '$lib/crypto/signalStore';

const store = new IndexedDBSignalProtocolStore(userId);
await store.init();
```

The module manages these items:

- It stores identity key pairs.
- It stores registration IDs.
- It stores prekeys and signed prekeys.
- It stores session records.
- It maintains a memory cache to improve performance.

The module implements the Signal Protocol `StorageType` interface.

#### 3. `signalSession.ts` (257 lines) - Session Management

This module establishes sessions and encrypts messages.

```typescript
import { encryptMessage, decryptMessage } from '$lib/crypto/signalSession';

const encrypted = await encryptMessage(store, recipientId, plaintext);
const plaintext = await decryptMessage(store, senderId, ciphertext);
```

**Key Functions:**

- `createSessionWithPrekeyBundle()` establishes a session with a remote user.
- `encryptMessage()` encrypts messages with the Signal Protocol.
- `decryptMessage()` decrypts messages with the Signal Protocol.
- `hasSession()` does a check for an existing session.
- `removeSessionWith()` deletes sessions.

#### 4. `signalKeyManager.ts` (232 lines) - Key Lifecycle

This module generates, imports, exports, and publishes keys.

```typescript
import { generateSignalIdentity, exportSignalKeys } from '$lib/crypto/signalKeyManager';

const identity = await generateSignalIdentity(store);
const keySet = await exportSignalKeys(store);
```

**Key Functions:**

- `generateSignalIdentity()` creates an identity and prekeys.
- `publishSignalPrekey()` publishes keys to the backend.
- `exportSignalKeys()` exports keys for backup.
- `importSignalKeys()` restores keys from a backup.

#### 5. `signalBackup.ts` (126 lines) - Backend Sync

This module synchronizes encrypted keys with the backend.

```typescript
import { exportAndEncryptSignalKeys } from '$lib/crypto/signalBackup';

const encrypted = await exportAndEncryptSignalKeys(store, deviceId, password);
await authService.storeSignalKeys(deviceId, encrypted);
```

**Key Functions:**

- `hasLocalKeys()` does a check for local keys.
- `exportAndEncryptSignalKeys()` exports keys with AES-256-GCM encryption.
- `decryptAndImportSignalKeys()` decrypts and imports encrypted keys.
- `clearSignalState()` performs database cleanup.
- `generateAndPublishIdentity()` completes the setup procedure.

#### 6. `signalUtils.ts` (53 lines) - Utilities

This module supplies data conversion and helper functions.

```typescript
import { arrayBufferToBase64, base64ToArrayBuffer } from '$lib/crypto/signalUtils';

const base64 = arrayBufferToBase64(buffer);
const buffer = base64ToArrayBuffer(base64);
```

**Functions:**

- `arrayBufferToBase64()` converts binary data to base64.
- `base64ToArrayBuffer()` converts base64 data to binary.
- `arrayBufferEquals()` compares buffers safely.

#### 7. `signalConstants.ts` (25 lines) - Configuration

This module supplies the shared constants.

```typescript
import { DEFAULT_DEVICE_ID, PREKEY_COUNT } from '$lib/crypto/signalConstants';
```

**Constants:**

- `DEFAULT_DEVICE_ID` = 1
- `DEFAULT_SIGNED_PREKEY_ID` = 1
- `PREKEY_COUNT` = 5
- `MAX_PREKEY_SCAN` = 100
- `STORE_NAME` = 'state'
- `DB_NAME_PREFIX` = 'signal-protocol-store-'

### Design Principles Applied

<a id="-single-responsibility-principle-srp"></a>
#### Single Responsibility Principle (SRP)

The Single Responsibility Principle assigns one responsibility to each module:

- `signalStore` manages storage.
- `signalSession` manages sessions.
- `signalKeyManager` manages keys.
- `signalBackup` manages synchronization.

<a id="-separation-of-concerns"></a>
#### Separation of Concerns

The architecture separates these responsibilities:

- signalStore handles data storage.
- signalSession and signalKeyManager contain the processing logic.
- signalBackup connects the client to the backend.
- signalUtils supplies utility functions.
- signalConstants supplies configuration constants.

<a id="-dependency-inversion"></a>
#### Dependency Inversion

The modules use these dependency rules:

- Modules use the store interface instead of a specific store implementation.
- Callers pass the store instance as a parameter.
- Tests can use a simulated store.

<a id="-openclosed-principle"></a>
#### Open/Closed Principle

The architecture supports these extension rules:

- New modules can extend the architecture.
- Existing modules remain stable during these extensions.

### Benefits: Before vs After

The table below preserves the original refactor assessment.
These estimates are historical claims, not new measurements.

| Metric               | Before (God Object) | After (Modular) | Improvement     |
| -------------------- | ------------------- | --------------- | --------------- |
| **Lines per file**   | 1,235               | ~180 avg        | **-85%**        |
| **Responsibilities** | 8+ mixed            | 1 per module    | **100%**        |
| **Test complexity**  | Very High           | Low             | **+80%**        |
| **Reusability**      | None                | 7 modules       | **700%**        |
| **Cognitive load**   | Overwhelming        | Manageable      | **+85%**        |
| **Maintainability**  | 2/10                | 9/10            | **+350%**       |
| **Breaking changes** | N/A                 | **ZERO**        | 100% compatible |

### Security Features Preserved

The original record stated that all 8 CVE fixes remained 100% intact.
The table preserves that security assessment.
It does not confirm the current hardening status.

| CVE     | Feature                     | Status |
| ------- | --------------------------- | ------ |
| CVE-001 | Password-based encryption   | ✅     |
| CVE-002 | AES-256-GCM                 | ✅     |
| CVE-003 | PBKDF2 (100k iterations)    | ✅     |
| CVE-005 | Device isolation            | ✅     |
| CVE-007 | Zero-knowledge architecture | ✅     |
| CVE-008 | Rate limiting               | ✅     |
| CVE-010 | Comprehensive audit logging | ✅     |
| CVE-011 | Strong password validation  | ✅     |

### Testing Strategy

#### Unit Tests (Module-Level)

Each module can be tested separately.

```typescript
// signalUtils.test.ts
import { arrayBufferToBase64 } from '$lib/crypto/signalUtils';

test('converts ArrayBuffer to base64', () => {
	const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
	expect(arrayBufferToBase64(buffer)).toBe('SGVsbG8=');
});

// signalStore.test.ts
import { IndexedDBSignalProtocolStore } from '$lib/crypto/signalStore';

test('stores and retrieves identity key', async () => {
	const store = new IndexedDBSignalProtocolStore('test-user');
	await store.init();
	// ... test storage operations
});
```

#### Integration Tests

Do a test of the interactions between modules.

```typescript
import { initSignal, encryptMessage, decryptMessage } from '$lib/crypto/signal';

test('complete encryption flow', async () => {
	await initSignal(userId);
	const encrypted = await encryptMessage(recipientId, 'Hello');
	const decrypted = await decryptMessage(senderId, encrypted);
	expect(decrypted).toBe('Hello');
});
```

### Migration Guide

The refactor record states that the public API is 100% compatible with earlier callers.
No code changes are necessary for existing callers.

```typescript
// Old code - still works perfectly!
import { initSignal, encryptMessage, decryptMessage } from '$lib/crypto/signal';

await initSignal(userId);
const encrypted = await encryptMessage(recipientId, plaintext);
const plaintext = await decryptMessage(senderId, encrypted);
```

Direct module imports are optional.

```typescript
// Direct module imports for specific functionality
import { IndexedDBSignalProtocolStore } from '$lib/crypto/signalStore';
import { encryptMessage } from '$lib/crypto/signalSession';
import { generateSignalIdentity } from '$lib/crypto/signalKeyManager';

const store = new IndexedDBSignalProtocolStore(userId);
await store.init();
const identity = await generateSignalIdentity(store);
```

### Future Enhancements

The architecture permits these possible extensions:

- Alternative storage backends can use SQLite or LocalStorage.
- A module can rotate keys automatically.
- Extensions can synchronize multiple devices.
- A module can monitor activity and collect measurements.
- Tests can use simulated implementations.

The fenced block below preserves the original workflow, test evidence, security checklist, and planned enhancements.
Its recorded results do not give current release approval.

````

---

## 🔧 Development Workflow

### Running the App

1. **Start backend services** (ports 8081-8083 via Docker)
2. **Start nginx** (port 85 via Docker)
3. **Start frontend** (`pnpm dev` on port 5173)
4. **Register a new account** at `http://localhost:5173/register`
5. **Login and start chatting** at `http://localhost:5173/chat`

### Testing

**📊 Test Coverage Statistics:**

- **240+ unit tests** with 85%+ code coverage
- **Zero explicit `any`** types - full TypeScript safety
- **Comprehensive E2E tests** for critical user flows
- **Mock utilities** for IndexedDB, WebCrypto, and API services

**Test Structure:**

```
tests/
├── unit/                   # Unit tests (Vitest)
│   ├── components/         # Svelte component tests
│   ├── services/           # Service layer tests
│   ├── stores/             # Store tests
│   ├── crypto/             # Signal Protocol module tests
│   ├── routes/             # Route component tests
│   └── utils/              # Utility function tests
├── e2e/                    # End-to-end tests (Playwright)
│   ├── auth.spec.ts        # Authentication flows
│   ├── chat.spec.ts        # Messaging functionality
│   └── mockBackend.ts      # Mock backend for E2E
├── fixtures/               # Test data and factories
├── mocks/                  # Mock implementations
└── utils/                  # Test utilities
    ├── authMock.ts         # Auth service mocks
    ├── fakeIndexedDB.ts    # IndexedDB test helpers
    ├── webcryptoMock.ts    # WebCrypto polyfill
    └── test-helpers.ts     # Common test utilities
```

**Running Tests:**

```bash
# Unit tests
pnpm test:unit              # Run once
pnpm test:unit -- --watch   # Watch mode
pnpm coverage:unit          # With coverage report

# E2E tests
pnpm test:e2e               # Run all E2E tests
pnpm test:e2e --ui          # Interactive UI mode
pnpm test:e2e --project=chromium  # Specific browser

# Code quality
pnpm lint                   # ESLint + Prettier
pnpm check                  # TypeScript + Svelte
pnpm format                 # Auto-fix formatting

# Complete validation pipeline
pnpm format && pnpm lint && npx tsc --noEmit && npx sv check && pnpm coverage:unit
```

**Test Examples:**

```typescript
// Component test with Svelte Testing Library
import { render, screen, fireEvent } from '@testing-library/svelte';
import ChatHeader from '$lib/components/ChatHeader.svelte';

it('displays user info and typing indicator', () => {
	render(ChatHeader, { user: { name: 'Alice' }, isTyping: true });
	expect(screen.getByText('Alice')).toBeTruthy();
	expect(screen.getByText('typing...')).toBeTruthy();
});

// Service test with mocked dependencies
import { vi } from 'vitest';
import { chatService } from '$lib/services/chat.service';

it('sends encrypted message', async () => {
	const mockEncrypt = vi.fn().mockResolvedValue({ type: 1, body: 'encrypted' });
	vi.spyOn(signalModule, 'encryptMessage').mockImplementation(mockEncrypt);

	await chatService.sendMessage('user-123', 'Hello');
	expect(mockEncrypt).toHaveBeenCalledWith('user-123', 'Hello');
});

// E2E test with Playwright
test('user can send and receive messages', async ({ page }) => {
	await page.goto('/login');
	await page.fill('[name="email"]', 'test@example.com');
	await page.fill('[name="password"]', 'password123');
	await page.click('button[type="submit"]');

	await page.waitForURL('/chat');
	await page.fill('[placeholder="Type a message"]', 'Hello!');
	await page.press('[placeholder="Type a message"]', 'Enter');

	await expect(page.locator('text=Hello!')).toBeVisible();
});
```

**Coverage Report:**

```
---------------------------|---------|----------|---------|---------|
File                       | % Stmts | % Branch | % Funcs | % Lines |
---------------------------|---------|----------|---------|---------|
All files                  |   85.76 |    74.84 |   84.07 |   85.76 |
 lib/components            |   99.61 |    79.32 |   92.85 |   99.61 |
 lib/crypto                |   90.67 |    84.57 |   83.16 |   90.67 |
 lib/services              |   92.50 |    65.43 |   89.06 |   92.50 |
 lib/stores                |   95.66 |    94.39 |  100.00 |   95.66 |
 lib/utils                 |   97.11 |    95.08 |  100.00 |   97.11 |
---------------------------|---------|----------|---------|---------|
```

**Test Best Practices:**

- ✅ Use `describe` blocks to group related tests
- ✅ Write descriptive test names that explain behavior
- ✅ Mock external dependencies (APIs, crypto, storage)
- ✅ Test both success and error paths
- ✅ Use `beforeEach` for test setup, avoid shared state
- ✅ Prefer `Parameters<typeof fn>[0]` over explicit `any` casts
- ✅ Create reusable test utilities in `tests/utils/`
- ✅ Keep tests focused on one behavior per test case

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
5. **Receive message**: Decrypt using stored session keys
6. **History**: Messages are decrypted when fetching conversation history

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

# Full validation pipeline
pnpm format && pnpm lint && npx tsc --noEmit && npx sv check

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
````
