# Chat Microservices Frontend

This is the frontend application for the [Chat Microservices](https://github.com/christiantroyandrada/chat-microservices) backend system. Built with SvelteKit, TypeScript, and Tailwind CSS, it provides a modern, responsive chat interface that connects to the microservices backend.

## Tech Stack

- **Framework**: [SvelteKit](https://kit.svelte.dev/) (v2.47.1)
- **Language**: TypeScript (v5.9.3)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) (v4.1.14)
- **Testing**:
  - Unit tests: Vitest (v3.2.4)
  - E2E tests: Playwright (v1.56.1)
- **Package Manager**: pnpm (recommended)

## Features

- 🔐 User authentication and registration
- 💬 Real-time chat messaging
- 🔔 Push notifications
- 📱 Responsive design for mobile and desktop
- 🎨 Modern UI with Tailwind CSS
- ⚡ Fast and lightweight SvelteKit application
- 🧪 Comprehensive test coverage

## Prerequisites

- Node.js (v22+ recommended)
- pnpm (or npm/yarn)
- Running instance of [Chat Microservices Backend](https://github.com/christiantroyandrada/chat-microservices)

## Backend Connection

This frontend connects to the following backend services:

### Via Gateway (Recommended - port 8080)

- **Auth/User API**: `http://localhost:8080/api/user`
- **Chat API**: `http://localhost:8080/api/chat`
- **Notifications API**: `http://localhost:8080/api/notifications`

### Direct Service Access (Alternative - via nginx on port 85)

- **User Service**: `http://localhost:85/api/user` (port 8081)
- **Chat Service**: `http://localhost:85/api/chat` (port 8082)
- **Notification Service**: `http://localhost:85/api/notifications` (port 8083)

**Note**: Make sure the backend services are running before starting the frontend. See the [backend README](https://github.com/christiantroyandrada/chat-microservices/blob/main/README.md) for setup instructions.

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

Or with npm:

```bash
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory (if needed):

```bash
# API Gateway URL (default)
PUBLIC_API_URL=http://localhost:8080

# Or use nginx reverse proxy
# PUBLIC_API_URL=http://localhost:85

# WebSocket URL (for real-time chat)
PUBLIC_WS_URL=ws://localhost:8082
```

### 3. Start Development Server

```bash
pnpm dev

# or start the server and open the app in a new browser tab
pnpm dev --open
```

The application will be available at `http://localhost:5173` (default Vite port).

## Available Scripts

### Development

- `pnpm dev` — Start development server
- `pnpm dev --open` — Start dev server and open in browser

### Building

- `pnpm build` — Create production build
- `pnpm preview` — Preview production build locally

### Code Quality

- `pnpm check` — Run Svelte type checking
- `pnpm check:watch` — Run type checking in watch mode
- `pnpm lint` — Run ESLint and Prettier checks
- `pnpm format` — Format code with Prettier

### Testing

- `pnpm test:unit` — Run unit tests (Vitest)
- `pnpm test:e2e` — Run end-to-end tests (Playwright)
- `pnpm test` — Run all tests

## Project Structure

```
chat-microservices-frontend/
├── src/
│   ├── lib/                    # Shared components and utilities
│   │   ├── assets/            # Images, icons, etc.
│   │   └── index.ts           # Library exports
│   ├── routes/                # SvelteKit routes (pages)
│   │   ├── +layout.svelte     # Root layout
│   │   ├── +page.svelte       # Home page
│   │   └── ...                # Additional routes
│   ├── app.css                # Global styles
│   ├── app.d.ts               # TypeScript declarations
│   └── app.html               # HTML template
├── static/                     # Static assets
│   └── robots.txt
├── e2e/                        # End-to-end tests
│   └── demo.test.ts
├── playwright.config.ts        # Playwright configuration
├── vite.config.ts             # Vite configuration
├── svelte.config.js           # SvelteKit configuration
├── tailwind.config.js         # Tailwind CSS configuration
├── tsconfig.json              # TypeScript configuration
└── package.json               # Dependencies and scripts
```

## Development Workflow

### 1. Ensure Backend is Running

Before starting frontend development, make sure the backend services are up:

```bash
# In the chat-microservices directory
docker-compose up -d --build

# Start the gateway separately (if using gateway)
cd gateway && npm run dev
```

Verify backend health:

```bash
curl -I http://localhost:85/api/health || true
# or
curl -I http://localhost:8080/api/health || true
```

### 2. Start Frontend Development

```bash
pnpm dev
```

### 3. Run Tests During Development

```bash
# Run unit tests in watch mode
pnpm test:unit

# Run E2E tests
pnpm test:e2e
```

## API Integration

The frontend communicates with the backend through RESTful APIs and WebSocket connections:

### Authentication Flow

1. User registers via `/api/user/register`
2. User logs in via `/api/user/login`
3. JWT token is stored (localStorage/sessionStorage)
4. Token is included in subsequent API requests

### Chat Flow

1. Establish WebSocket connection to chat service
2. Send/receive messages in real-time
3. Messages are persisted via `/api/chat/messages` endpoint

### Notifications

- Listen to notification events from `/api/notifications`
- Display in-app notifications
- Handle push notifications (if enabled)

## Building for Production

### Create Production Build

```bash
pnpm build
```

This generates an optimized production build in the `build/` directory.

### Preview Production Build

```bash
pnpm preview
```

### Deployment

The app can be deployed to various platforms:

- **Vercel** (recommended for SvelteKit)
- **Netlify**
- **Cloudflare Pages**
- **Node.js server** (with adapter-node)
- **Static hosting** (with adapter-static)

Install the appropriate [SvelteKit adapter](https://kit.svelte.dev/docs/adapters) for your target environment.

Example for Node.js:

```bash
pnpm add -D @sveltejs/adapter-node
```

Then update `svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-node';

export default {
	kit: {
		adapter: adapter()
	}
};
```

## Testing

### Unit Tests (Vitest)

```bash
# Run tests once
pnpm test:unit -- --run

# Run tests in watch mode
pnpm test:unit

# Run tests with coverage
pnpm test:unit -- --coverage
```

### End-to-End Tests (Playwright)

```bash
# Run E2E tests
pnpm test:e2e

# Run E2E tests in UI mode
pnpm test:e2e --ui

# Run E2E tests in a specific browser
pnpm test:e2e --project=chromium
```

## Troubleshooting

### Backend Connection Issues

**Problem**: Cannot connect to backend API

**Solution**:

1. Verify backend services are running: `docker-compose ps`
2. Check backend health endpoints:
   ```bash
   curl http://localhost:85/api/health
   curl http://localhost:8080/api/health
   ```
3. Verify `PUBLIC_API_URL` in `.env` matches your backend URL
4. Check CORS settings in backend services

### WebSocket Connection Failures

**Problem**: Real-time chat not working

**Solution**:

1. Ensure chat service is running on port 8082
2. Verify `PUBLIC_WS_URL` in `.env`
3. Check browser console for WebSocket errors
4. Verify firewall/proxy settings allow WebSocket connections

### Development Server Issues

**Problem**: Development server won't start

**Solution**:

1. Clear node_modules and reinstall: `rm -rf node_modules && pnpm install`
2. Check if port 5173 is already in use
3. Clear Vite cache: `rm -rf .svelte-kit`
4. Update dependencies: `pnpm update`

### Build Errors

**Problem**: Production build fails

**Solution**:

1. Run type checking: `pnpm check`
2. Fix ESLint errors: `pnpm lint`
3. Clear build artifacts: `rm -rf build .svelte-kit`
4. Ensure all environment variables are set

## Security Considerations

- 🔒 Always use HTTPS in production
- 🔑 Never commit sensitive credentials or tokens
- 🛡️ Implement proper JWT token handling
- 🚫 Validate and sanitize all user inputs
- 🔐 Use secure cookie settings for authentication
- 📝 Follow OWASP guidelines for web security

See the [backend security guidelines](https://github.com/christiantroyandrada/chat-microservices/blob/main/SECURITY.md) for additional security best practices.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and test thoroughly
4. Run linting and tests: `pnpm lint && pnpm test`
5. Commit your changes: `git commit -am 'Add my feature'`
6. Push to the branch: `git push origin feature/my-feature`
7. Create a Pull Request

## Related Projects

- [Chat Microservices Backend](https://github.com/christiantroyandrada/chat-microservices) — Node.js + TypeScript microservices backend

## License

This project is private and proprietary. All rights reserved.

## Support

For issues, questions, or contributions, please refer to the main [Chat Microservices repository](https://github.com/christiantroyandrada/chat-microservices) or contact the development team.
