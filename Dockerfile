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

# Drop dev dependencies (vite, typescript, vitest, electron, …) so the
# production stage copies only the small runtime tree.
RUN npm prune --omit=dev

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:24-alpine AS production

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

WORKDIR /app

# Copy only the package manifests and the pruned (pure-JS) production deps
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled artefacts
COPY --from=builder /app/backend/dist  ./backend/dist
COPY --from=builder /app/cli/dist      ./cli/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY docker/mcpscope-cli /usr/local/bin/mcpscope
RUN chmod +x /usr/local/bin/mcpscope

# Data directory — mount a volume here for SQLite persistence. Owned by the
# unprivileged node user the container runs as.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3030

ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=3030
ENV BACKEND_DATA_DIR=/data
ENV BACKEND_STATIC_DIR=/app/frontend/dist

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:3030/api/health || exit 1

CMD ["node", "backend/dist/server.js"]
