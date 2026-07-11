# ─── Stage 1: Build ───────────────────────────────────────────────────────────
# Pure-JS dependency tree (SQLite is Node's built-in node:sqlite), so no native
# toolchain (python3/make/g++) is required.
FROM node:24-alpine AS builder

WORKDIR /app

# Install all dependencies (dev + prod) so we can build. The BuildKit cache
# mount keeps the npm download cache across builds so a rebuild doesn't
# re-fetch every package.
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source and build everything
COPY . .
RUN npm run build          # Vite → frontend/dist/
RUN npm run build:backend  # tsc  → backend/dist/
RUN npm run build:cli      # tsc  → cli/dist/

# Drop dev dependencies (vite, typescript, vitest, electron, …) so the
# production stage copies only the small runtime tree.
RUN npm prune --omit=dev

# Strip docs, TypeScript declarations, and sourcemaps from the production
# dependency tree (~25 MB of the ~55 MB) — none of it is read at runtime.
# LICENSE files are kept: we redistribute these packages in the image.
RUN find node_modules -type f \
  \( -name '*.md' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) \
  -delete

# Strip the node binary's debug symbols (~128 MB → ~111 MB). The dynamic
# symbol table survives stripping, and there are no native addons anyway.
RUN apk add --no-cache binutils && strip /usr/local/bin/node

# ─── Stage 2: Production image ────────────────────────────────────────────────
# Not node:24-alpine: that base also carries npm (~18 MB), the Node headers
# (~7 MB), yarn (~5 MB) and corepack — none of which is needed to *run* the app.
# Starting from bare Alpine and copying in only the node binary (plus its two
# shared-library deps via libstdc++) cuts the image by ~100 MB. The Alpine
# version is pinned to the one the builder's node binary was linked against;
# the release workflow smoke-tests the image before pushing, so a mismatch
# after a base bump fails the build, not the user.
FROM alpine:3.24 AS production

RUN apk add --no-cache libstdc++ \
  && addgroup -g 1000 node \
  && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=builder /usr/local/bin/node /usr/local/bin/node

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

# Data directory — mount a volume here for SQLite persistence. Only /data needs
# to be writable by the unprivileged node user; /app is read-only at runtime
# (the app reads its own files and writes only to /data), so it stays
# root-owned and world-readable. A `chown -R /app` here would duplicate the
# whole node_modules tree into an extra image layer (~75 MB) for nothing.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3066

ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=3066
ENV BACKEND_DATA_DIR=/data
ENV BACKEND_STATIC_DIR=/app/frontend/dist

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:3066/api/health || exit 1

CMD ["node", "backend/dist/server.js"]
