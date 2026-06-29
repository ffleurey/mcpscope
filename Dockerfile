# ─── Stage 1: Build ───────────────────────────────────────────────────────────
# Pure-JS dependency tree (SQLite is Node's built-in node:sqlite), so no native
# toolchain (python3/make/g++) is required.
FROM node:24-alpine AS builder

WORKDIR /app

# Install all dependencies (dev + prod) so we can build
COPY package*.json ./
RUN npm ci

# Copy source and build everything
COPY . .
RUN npm run build          # Vite → frontend/dist/
RUN npm run build:backend  # tsc  → backend/dist/
RUN npm run build:cli      # tsc  → cli/dist/

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:24-alpine AS production

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

WORKDIR /app

# Copy only the package manifests and the (pure-JS) production deps from builder
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled artefacts
COPY --from=builder /app/backend/dist  ./backend/dist
COPY --from=builder /app/cli/dist      ./cli/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY docker/mcpscope-cli /usr/local/bin/mcpscope
RUN chmod +x /usr/local/bin/mcpscope

# Data directory — mount a volume here for SQLite persistence
RUN mkdir -p /data

EXPOSE 3030

ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=3030
ENV BACKEND_DATA_DIR=/data
ENV BACKEND_STATIC_DIR=/app/frontend/dist

CMD ["node", "backend/dist/server.js"]
