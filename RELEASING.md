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
npm run check:cli
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

- `ghcr.io/ffleurey/mcpscope:1.2.3` — exact version
- `ghcr.io/ffleurey/mcpscope:1.2` — major.minor
- `ghcr.io/ffleurey/mcpscope:latest` — always points to the latest release

Monitor progress under the **Actions** tab on GitHub.

---

## Pulling a released image

The end-user run path — GHCR login (PAT with `read:packages`), `docker pull`, and the
recommended persistent `docker run` — is the [quick-start tutorial](TUTORIAL.md). It is not
repeated here so the two docs cannot drift.

Release-side notes for the published image:

- **Tags:** `:X.Y.Z` (exact), `:X.Y` (major.minor), and `:latest` (see step 5 above).
- **CLI in-container:** the image bundles the CLI, so commands can run against the same container:

  ```bash
  docker exec -i mcpscope-app mcpscope list
  docker exec -i mcpscope-app mcpscope create "test session"
  ```

- **docker-compose (optional):** point `image:` at `ghcr.io/ffleurey/mcpscope:latest` (and drop
  the `build: .` line) in `docker-compose.yml`, then `docker compose up -d`.

---

## How the version flows

```text
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
