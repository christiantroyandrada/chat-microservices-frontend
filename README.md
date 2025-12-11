# Chat Microservices Frontend

Modern, responsive real-time chat application built with SvelteKit, TypeScript, and Tailwind CSS. Features end-to-end encryption using the Signal Protocol.

## ✨ Features

- **Real-time Messaging** with WebSocket (Socket.IO)
- **End-to-End Encryption** (Signal Protocol - X3DH + Double Ratchet)
- **Secure Key Backup** (AES-256-GCM encryption with PBKDF2)
- **Responsive Design** with dark/light theme
- **Toast Notifications** with live updates
- **Typing Indicators** and presence detection
- **Conversation Management** with unread counts

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Open http://localhost:5173
```

## 🧪 Testing

```bash
# Type checking
pnpm check

# Unit tests
pnpm test:unit

# E2E tests (requires backend running)
pnpm test:e2e
```

## 📁 Project Structure

```
src/
├── lib/
│   ├── components/    # Svelte components (ChatList, MessageList, etc.)
│   ├── crypto/        # Signal Protocol encryption
│   ├── services/      # API client, WebSocket, auth
│   ├── stores/        # Svelte stores (auth, chat, notifications)
│   ├── types/         # TypeScript interfaces
│   └── utils/         # Utilities (validation, sanitization)
├── routes/            # SvelteKit pages
└── app.html           # HTML template
```

## 🔒 Security Features

- **Signal Protocol** for E2E encrypted messaging
- **Client-side key encryption** before server storage
- **CSRF Protection** via SvelteKit hooks
- **XSS Prevention** with input sanitization
- **Secure cookie handling** (httpOnly, SameSite)

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | SvelteKit 2.0 + Svelte 5 |
| Language | TypeScript 5.4 |
| Styling | Tailwind CSS 4.0 |
| Testing | Vitest + Playwright |
| E2EE | @privacyresearch/libsignal-protocol-typescript |
| Real-time | Socket.IO Client |
| Build | Vite |

## 📚 Documentation

- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development guide and architecture details

## 🔧 Environment Variables

```env
PUBLIC_API_URL=http://localhost:80  # Backend API URL
```

## 📄 License

MIT License - see LICENSE file for details.
