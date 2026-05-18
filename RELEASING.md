# Releasing

## Overview

Releases are driven by **git tags**. When a GitHub Release is published from a tag, the CI workflow automatically builds and pushes a versioned Docker image to the GitHub Container Registry (GHCR) at `ghcr.io/ffleurey/mcpscope`.

The version is baked into the image at build time and shown in the app footer.

---

## Release checklist

### 1. Ensure main is clean and tests pass

```bash
git checkout main && git pull
npm test
npm run check && npm run check:backend
```

### 2. Bump the version

Use `npm version` — it updates `package.json` and creates a git tag automatically.

```bash
npm version patch    # 1.0.0 → 1.0.1  (bug fixes)
npm version minor    # 1.0.0 → 1.1.0  (new features)
npm version major    # 1.0.0 → 2.0.0  (breaking changes)
```

### 3. Push the tag

```bash
git push --follow-tags
```

### 4. Create a GitHub Release

```bash
gh release create v$(node -p "require('./package.json').version") \
  --title "v$(node -p "require('./package.json').version")" \
  --notes "Brief description of what changed"
```

Or use the GitHub web UI: **Releases → Draft a new release → choose the tag**.

### 5. CI builds and publishes the image

The workflow in `.github/workflows/release.yml` triggers automatically. It pushes:

- `ghcr.io/ffleurey/mcpscope:v1.2.3` — exact version
- `ghcr.io/ffleurey/mcpscope:1.2` — major.minor
- `ghcr.io/ffleurey/mcpscope:latest` — always points to the latest release

Monitor progress under the **Actions** tab on GitHub.

---

## Pulling a released image

Users need a GitHub personal access token (PAT) with `read:packages` scope.

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME --password YOUR_PAT
docker pull ghcr.io/ffleurey/mcpscope:latest
```

Run a quick local instance without persistence:
```bash
docker run -d --name mcpscope-app -p 3030:3030 ghcr.io/ffleurey/mcpscope:latest
```

Run with persistent local data:
```bash
docker run -d --name mcpscope-app -p 3030:3030 -v mcpscope-data:/data ghcr.io/ffleurey/mcpscope:latest
```

The image also includes the CLI, so you can run commands inside the same container:

```bash
docker exec -i mcpscope-app mcpscope list
docker exec -i mcpscope-app mcpscope create "test session"
```

Or with docker-compose (optional convenience):
```bash
# Edit docker-compose.yml to use the GHCR image instead of building locally:
#   image: ghcr.io/ffleurey/mcpscope:latest
#   (remove the `build: .` line)
docker compose up -d
```

Then open **http://localhost:3030**.

---

## How the version flows

```
npm version patch
  → updates package.json "version"
  → creates git tag vX.Y.Z

git push --follow-tags
  → tag arrives on GitHub

gh release create
  → publishes GitHub Release

GitHub Actions (.github/workflows/release.yml)
  → builds Docker image with --build-arg APP_VERSION=vX.Y.Z
  → pushes to GHCR with semver tags

Running container
  → APP_VERSION env var → /api/health response → frontend store → UI footer
```
