##############################################################################
# Environment-aware SvelteKit frontend build
# 
# Build args:
#   BUILD_ENV=development (default) - Uses http://localhost for API URLs
#   BUILD_ENV=production            - Uses https://chat.ctaprojects.xyz for API URLs
#
# You can also override PUBLIC_API_URL and PUBLIC_WS_URL directly:
#   docker build --build-arg PUBLIC_API_URL=https://example.com .
#
# Usage:
#   Local dev:  docker compose up (uses default development URLs)
#   Production: docker compose -f docker-compose.yml -f docker-compose.prod.yml up
#               OR: docker build --build-arg BUILD_ENV=production .
##############################################################################

# Build stage - use Debian 12 (bookworm) for better security updates
FROM node:22-bookworm-slim AS builder

# OCI Image Labels for traceability and security compliance
LABEL org.opencontainers.image.title="Chat Frontend" \
      org.opencontainers.image.description="SvelteKit frontend for chat application" \
      org.opencontainers.image.vendor="Chat App" \
      org.opencontainers.image.source="https://github.com/christiantroyandrada/chat-microservices-frontend" \
      org.opencontainers.image.documentation="https://github.com/christiantroyandrada/chat-microservices-frontend/blob/master/README.md" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.base.name="gcr.io/distroless/nodejs22-debian12:nonroot"

# Install pnpm
RUN npm install -g pnpm@latest

WORKDIR /usr/src/app

# Build environment selector (development or production)
ARG BUILD_ENV=development

# Optional: explicit API URL overrides (takes precedence over BUILD_ENV defaults)
ARG PUBLIC_API_URL
ARG PUBLIC_WS_URL

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

# Build with environment-appropriate URLs
# Priority: explicit ARG > BUILD_ENV default > fallback
RUN set -e; \
    if [ -n "$PUBLIC_API_URL" ]; then \
      # Explicit URL provided via build arg
      API_URL="$PUBLIC_API_URL"; \
      WS_URL="${PUBLIC_WS_URL:-$PUBLIC_API_URL}"; \
      echo "📦 Building with CUSTOM URLs"; \
    elif [ "$BUILD_ENV" = "production" ]; then \
      # Production environment defaults
      API_URL="https://chat.ctaprojects.xyz"; \
      WS_URL="https://chat.ctaprojects.xyz"; \
      echo "📦 Building for PRODUCTION environment"; \
    else \
      # Development environment defaults
      API_URL="http://localhost"; \
      WS_URL="http://localhost"; \
      echo "🔧 Building for DEVELOPMENT environment"; \
    fi && \
    echo "   PUBLIC_API_URL=$API_URL" && \
    echo "   PUBLIC_WS_URL=$WS_URL" && \
    export PUBLIC_API_URL="$API_URL" && \
    export PUBLIC_WS_URL="$WS_URL" && \
    pnpm run build && \
    pnpm prune --prod && \
    rm -rf /root/.npm /root/.local/share/pnpm /tmp/*

# Production stage - use distroless for security
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:c9a583e5754af75089ff573bff654001d882f02c923e18c4b8e365f12ac2aede

WORKDIR /usr/src/app

# Copy built application and production node_modules from builder
COPY --from=builder /usr/src/app/build ./build
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package.json ./

# SvelteKit with adapter-node runs on port 3000 by default
EXPOSE 3000

# Run the built application
CMD ["build/index.js"]
