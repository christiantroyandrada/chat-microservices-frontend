# Chat Microservices Frontend

This chat application uses SvelteKit, TypeScript, and Tailwind CSS.
It supports responsive layouts and real-time messages.

The application uses the Signal Protocol for end-to-end encryption.
End-to-end encryption prevents the server from reading message content.

<a id="-features"></a>
## Features

The application has these features:

- The application sends real-time messages through WebSocket connections with Socket.IO.
- The Signal Protocol uses X3DH key exchange and the Double Ratchet algorithm for end-to-end encryption.
- Key backups use AES-256-GCM encryption.
  PBKDF2 derives the encryption keys from passwords.
- The responsive interface has dark and light themes.
- Toast notifications show live updates.
- Typing indicators and presence detection show user activity.
- Conversation management includes unread message counts.

<a id="-quick-start"></a>
## Quick Start

Install the dependencies.
Start the development server.
Open the address shown in the example.

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Open http://localhost:5173
```

<a id="-testing"></a>
## Testing

Run the type check.
Run the unit tests.
Before you run the end-to-end tests, start the backend.

```bash
# Type checking
pnpm check

# Unit tests
pnpm test:unit

# E2E tests (requires backend running)
pnpm test:e2e
```

<a id="-project-structure"></a>
## Project Structure

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

<a id="-security-features"></a>
## Security Features

The application has these security features:

- The Signal Protocol encrypts messages between clients.
- The client encrypts keys before the server stores them.
- SvelteKit hooks protect against cross-site request forgery (CSRF).
- Input sanitization prevents cross-site scripting (XSS).
- Cookies use httpOnly and SameSite settings.

<a id="-tech-stack"></a>
## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | SvelteKit 2.0 + Svelte 5 |
| Language | TypeScript 5.4 |
| Styling | Tailwind CSS 4.0 |
| Testing | Vitest + Playwright |
| E2EE | @privacyresearch/libsignal-protocol-typescript |
| Real-time | Socket.IO Client |
| Build | Vite |

<a id="-documentation"></a>
## Documentation

[DEVELOPMENT.md](./DEVELOPMENT.md) describes development procedures and the application architecture.

<a id="-environment-variables"></a>
## Environment Variables

Use this environment variable for the backend API address.

```env
PUBLIC_API_URL=http://localhost:80  # Backend API URL
```

<a id="-license"></a>
## License

MIT License - see LICENSE file for details.
