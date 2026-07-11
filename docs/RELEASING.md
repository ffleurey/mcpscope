# Releasing

## Overview

Releases are driven by **git tags**. When a GitHub Release is published from a tag, the CI
workflow (`.github/workflows/release.yml`) automatically, in parallel:

- **npm** — publishes the package (CLI + bundled backend/frontend) to the npm registry via
  [trusted publishing (OIDC)](#npm-trusted-publishing) — no stored token.
- **Docker** — builds and pushes a versioned image to GHCR at `ghcr.io/ffleurey/mcpscope`.
- **Electron desktop apps** — builds installers on a macOS / Windows / Linux matrix and uploads
  them to the GitHub Release as assets: macOS `.dmg` (**Apple Silicon / arm64 only** — set in
  `electron-builder.yml`), Windows `.exe` (NSIS), and Linux `AppImage` / `.deb` / `.rpm` /
  `.tar.gz`. Unsigned for now — macOS Gatekeeper / Windows SmartScreen warn on first run.

The version is baked into the Docker image at build time (shown in the app footer); the Electron
installers take their version from `package.json`, which **must** match the release tag (`vX.Y.Z`).
`npm version` (step 2) keeps them in sync.

---

## Release checklist

### 1. Ensure main is clean and tests pass

```bash
git checkout main && git pull
npm run verify   # full gate — see TESTING.md
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

### 5. CI builds and publishes the artifacts

The workflow in `.github/workflows/release.yml` triggers automatically and runs three jobs:

**npm** → publishes the `mcpscope` package (so `npm install -g mcpscope` / `npx mcpscope`
work) via [trusted publishing](#npm-trusted-publishing) — no secret to store. `prepublishOnly`
runs `build:all`, so the published tarball ships the built `cli/dist` + `backend/dist` +
`frontend/dist` (the `files` allow-list in package.json). A version already on npm is skipped, so
re-running a release is safe.

**Docker** → pushes to GHCR:

- `ghcr.io/ffleurey/mcpscope:1.2.3` — exact version
- `ghcr.io/ffleurey/mcpscope:1.2` — major.minor
- `ghcr.io/ffleurey/mcpscope:latest` — always points to the latest release

**Electron** (matrix: ubuntu / macos / windows) → uploads installers to the GitHub Release:

- macOS `.dmg`, Windows `.exe`, Linux `AppImage` + `.deb` + `.rpm` + `.tar.gz` (via electron-builder
  `--publish always`, attached to the release that matches the tag).

Monitor progress under the **Actions** tab on GitHub. If a single OS build fails, the others
still publish (`fail-fast: false`); re-run the failed matrix leg from the Actions UI.

---

## npm trusted publishing

The npm job authenticates with [trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers/):
GitHub Actions mints a short-lived, per-run token that npm verifies against the package's
configured trusted publisher. There is **no `NPM_TOKEN` secret** to store or rotate, and each
publish carries an automatic provenance attestation.

One-time setup (already done for `mcpscope`):

1. **Bootstrap the package** — trusted publishing can only be configured on a package that already
   exists, so `0.1.0` was published once manually (`npm publish --access public` after `npm login`).
2. **Enable the trusted publisher** on npmjs.com → the `mcpscope` package → *Settings → Publishing
   access → Trusted Publisher → GitHub Actions*, with organization/user `ffleurey`, repository
   `mcpscope`, and workflow `release.yml`.

The workflow needs `permissions: id-token: write` and npm ≥ 11.5.1 (both set in `release.yml`);
the publish step skips any version already on the registry, so `0.1.0` is a no-op and re-running a
release is safe.

---

## Pulling a released image

The end-user run path — `docker pull` (the image is public; no login needed) and the
recommended persistent `docker run` — is the [quick-start tutorial](../TUTORIAL.md). It is not
repeated here so the two docs cannot drift.

Release-side notes for the published image:

- **Tags:** `:X.Y.Z` (exact), `:X.Y` (major.minor), and `:latest` (see step 5 above).
- **CLI in-container:** the image bundles the CLI, so commands run against the same container (`docker exec -i mcpscope-app mcpscope <cmd>`) — see [../CLI.md](../CLI.md).

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
  → (npm) builds cli/backend/frontend → publishes the mcpscope package to the npm registry
  → (Docker) builds image with --build-arg APP_VERSION=vX.Y.Z → pushes to GHCR with semver tags
  → (Electron) builds dmg/exe/AppImage/deb/rpm/tar.gz per OS → uploads them to the GitHub Release

Running container
  → APP_VERSION env var → /api/health response → frontend store → UI footer
```
