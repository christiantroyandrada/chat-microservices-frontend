# Build stage - use Debian 12 (bookworm) for better security updates
FROM node:22-bookworm-slim AS builder

# Install pnpm
RUN npm install -g pnpm@latest

WORKDIR /usr/src/app

# Build arguments for SvelteKit public env vars (baked into client JS)
ARG PUBLIC_API_URL=http://localhost:85
ARG PUBLIC_WS_URL=http://localhost:85

# Set as environment variables for the build process
ENV PUBLIC_API_URL=$PUBLIC_API_URL
ENV PUBLIC_WS_URL=$PUBLIC_WS_URL

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN apt-get update \
	&& apt-get upgrade -y \
	&& rm -rf /var/lib/apt/lists/* \
	&& pnpm install --frozen-lockfile \
	&& pnpm store prune

# Copy source code
COPY . .

# Build the application (PUBLIC_* vars are baked in here)
RUN pnpm run build \
	&& pnpm prune --prod \
	&& rm -rf /root/.npm /root/.local/share/pnpm /tmp/*

# Production stage - use distroless for security
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:1014312994b734e9f3bba23bb96fab389119750a98f14bc76936dc2a7e72c3da

WORKDIR /usr/src/app

# Copy built application and production node_modules from builder
COPY --from=builder /usr/src/app/build ./build
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package.json ./

# SvelteKit with adapter-node runs on port 3000 by default
EXPOSE 3000

# Run the built application
CMD ["build/index.js"]
