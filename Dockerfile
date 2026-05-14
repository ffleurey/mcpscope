# ─── Stage 1: Build ───────────────────────────────────────────────────────────
# Full Node + build tools needed to compile better-sqlite3 native module
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install all dependencies (dev + prod) so we can build
COPY package*.json ./
RUN npm ci

# Copy source and build everything
COPY . .
RUN npm run build          # Vite → frontend/dist/
RUN npm run build:backend  # tsc  → backend/dist/

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:22-alpine AS production

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

WORKDIR /app

# Copy only the package manifests and install production deps
# (better-sqlite3 native .node is copied from builder — same arch/libc)
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled artefacts
COPY --from=builder /app/backend/dist  ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Data directory — mount a volume here for SQLite persistence
RUN mkdir -p /data

EXPOSE 3030

ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=3030
ENV BACKEND_DATA_DIR=/data
ENV BACKEND_STATIC_DIR=/app/frontend/dist

CMD ["node", "backend/dist/server.js"]
