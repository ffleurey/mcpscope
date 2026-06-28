# Improve Distribution: Single-executable and desktop packaging

> **Status (2026-06-21): the recommended near-term path shipped.** `mcpscope serve` boots the
> bundled backend + frontend and opens the browser, so `npm install -g mcpscope && mcpscope serve`
> works (runtime deps corrected, `files` ships the built artifacts; publishing to the public npm
> registry is the only remaining step — flip `"private"` + `npm publish`). The SEA / Electron /
> WASM-SQLite options below remain **future, optional** paths, relevant only if a single binary or
> a desktop shell becomes a priority. The rest of this doc is kept as the options analysis.

---

## V1 plan (2026-06-28): node:sqlite swap + Node 24 + unsigned Electron

Decision: pursue an **Electron desktop distribution**, enabled by **replacing `better-sqlite3`
with the built-in `node:sqlite` (`DatabaseSync`)** so packaging needs no native rebuild.

### Verified (tested against local node:sqlite)
Our usage ports cleanly. Bare named params (`@id` in SQL bound with `{ id }` — no `@` in keys)
work out of the box; `.run()` returns `{ changes, lastInsertRowid }` (`changes` is a `number`);
`.get`/`.all`/positional `?` are identical; boolean binding throws (same as today). We use **none**
of the hard-to-port features (`.iterate/.pluck/.raw`, custom functions, backup/serialize,
BigInt/safeIntegers, BLOB/Buffer, SQLite error-code catching, constructor options). The real
surface is just: **pragmas, transactions, and the `Database` type import.**

### GATE — PASSED (2026-06-28)
Spiked Electron 42.5.0 (bundles **Node 24.17.0**, matching our floor). `node:sqlite` works with
**no flag** — WAL pragma + named params + prepare/get all succeed, verified in the **real main
process** (`--headless`), not just `ELECTRON_RUN_AS_NODE`. The early Electron-35 flag problem
(electron/electron#45532, Node 22.9) is gone on current Electron. Electron route is unblocked.

### Decisions
- **Node floor: 24** (current LTS; engines `>=24`). node:sqlite flag-free and more mature there.
- **Transaction helper: savepoint-aware** (no per-call-site nesting audit). Mirrors better-sqlite3's
  auto-nesting so behavior is preserved regardless of call graph.
- **Electron v1: unsigned artifacts** (no Apple notarization / Windows Authenticode yet) to validate
  the pipeline before investing in certs.

### Workstream A — drop better-sqlite3 → node:sqlite (~1 day)
- `db.ts`: `new Database` → `new DatabaseSync`; `.pragma("…")` → `.exec("PRAGMA …")`.
- Shared type alias (`BackendConnection = DatabaseSync`) replacing `Database.Database` in ~15 files.
- `runInTransaction(conn, fn)` helper (BEGIN/COMMIT/ROLLBACK, savepoint-aware, returns fn's value);
  convert the 15 `connection.transaction(fn)()` sites.
- Drop the 5 `.prepare<[Params],Row>()` generics (rely on existing `as Row` casts).
- Suppress the ExperimentalWarning via `--disable-warning=ExperimentalWarning` (not NODE_NO_WARNINGS).
- Remove `better-sqlite3` + `@types/better-sqlite3`. Run the DB-touching test suite as the net.

### Workstream B — Node 24 bump (~½ day)
- Add `"engines": { "node": ">=24" }`.
- Dockerfile: `node:22-alpine` → `node:24-alpine`; **delete** the native-build layer
  (`python3 make g++`) and native-`.node` copy comments. CI already on Node 24.

### Workstream C — Electron distribution (~1.5–2 wks, dominated by CI not code)
- `electron/` (main + preload). Boot backend in-process exactly like `cli/src/commands/serve.ts`,
  then open a BrowserWindow on `http://127.0.0.1:<port>`. Data dir via `app.getPath('userData')`.
- `electron-builder` → `.dmg` (arm64+x64), NSIS `.exe`, AppImage. **No electron-rebuild/node-gyp**
  (the payoff of A). asar must include `backend/dist` + `frontend/dist`.
- Release CI: 3-OS matrix, **unsigned** for v1. Validate AppImage early (Open Design had issues);
  fall back to a Linux tarball if needed. Auto-update (electron-updater) deferred.

### Compatibility — must not break any existing run mode
Hard constraint: every current way to run mcpscope keeps working. The DB swap and warning
suppression touch all entry points, so handle them once, centrally.

| Run mode | Command | What to watch |
|---|---|---|
| Dev (full) | `npm run dev` (tsx watch backend + vite) | tsx uses the dev's local Node → must be ≥24; node:sqlite works under tsx; warning suppressed |
| Dev (CLI) | `npm run dev:cli` (tsx) | same |
| Backend only | `npm run start:backend` (`node backend/dist/server.js`) | DB opens via db.ts; warning suppressed |
| Global install | `npm i -g mcpscope && mcpscope serve` | boots backend in-process from dist (serve.ts); `engines:>=24`; bin shebang is plain `node` (can't pass flags → suppress in-code) |
| Docker | `docker run …` (`node:24-alpine`) | node:sqlite is compiled into the node binary on **musl/alpine** too → also removes the old better-sqlite3 native-compile + apk build-deps |
| Electron | packaged app | covered by gate (Node 24.17, flag-free) |

**Warning suppression strategy (covers all entry points at once):** all paths open the DB through
`db.ts`. Suppress the `ExperimentalWarning` programmatically there (e.g. a `suppressWarnings.js`
imported *before* `node:sqlite` in source order — ESM evaluates imports in order) rather than via
per-launcher `--disable-warning` flags, since the `bin` shebang can't carry flags portably. Verify
the warning is gone in dev (tsx), `start:backend`, and `serve`.

**Local-dev Node implication:** this repo's current dev machine is on Node 22.22; `engines:>=24`
means devs should upgrade locally to match CI/Docker (node:sqlite *runs* on 22.22, but we're
standardizing on 24). Flagged so the bump isn't a surprise.

**Verification (run before merging A+B):** `npm run verify` on Node 24, then smoke-test each row of
the table above — `npm run dev` opens a working DB, `mcpscope serve` from a packed tarball
(`npm pack`) serves + persists, and `docker build` + `docker run` boots without the apk build layer.

### Sequence
1) Electron node:sqlite spike (gate ✅) → 2) Workstream A ✅ + B ✅ → 3) Workstream C (next).
Each of 2/3 must pass the compatibility matrix above before merge.

**Progress (branch `node24-sqlite-and-electron`):**
- ✅ A — DB swap done; `npm run verify` green (334 tests). Note: node:sqlite is
  *stricter* than better-sqlite3 on extra named-param keys ("Unknown named
  parameter") — restored lenient behaviour via `setAllowUnknownNamedParameters`
  on every statement at the connection factory (db.ts).
- ✅ B — engines `>=24`; Dockerfile on node:24-alpine with the apk build layer
  removed. Verified: image builds toolchain-free and the container boots on
  alpine/musl, serving the frontend + a DB-backed API.
- Compatibility verified on all current run modes: full test suite (vitest/tsx),
  `node backend/dist/server.js`, `mcpscope serve`, and Docker. ExperimentalWarning
  suppressed on Node 22 *and* 24 (createRequire load order, see connection.ts).
- ✅ C (V1, Linux verified) — `electron/src/main.ts` boots the backend in-process
  (free port, single-instance lock, userData data dir) + `electron-builder.yml`
  (dmg/nsis/AppImage+tar.gz, unsigned, asar off for V1). Linux AppImage (128M) and
  tar.gz build and boot from a clean /tmp extraction; UI hits the node:sqlite API.
  Confirmed `@electron/rebuild` finds **no native deps** to rebuild.
  - Packaging bug fixed: `fastify` was in both deps + devDeps → electron-builder
    pruned it as dev. Now prod-only.
  - **Remaining for C:** cross-platform release CI (dmg needs macOS runner, nsis
    needs Windows runner — can't build locally on Linux); app icon + `desktopName`
    (currently default Electron icon); decide whether dev (Node 22) still matters
    after the floor bump. Later: revisit `asar: true` + asarUnpack; code signing
    + notarization (deferred past v1); auto-update (electron-updater).
  - Dev tip: `npm run start:electron` (after `build:all` + `build:electron`);
    `npm run dist:electron:dir` for a quick unpacked build, `dist:electron` for installers.

## Context

mcpscope currently ships two ways for end users:

1. **Docker** — the released/product workflow (`docker run mcpscope/mcpscope`)
2. **Developer setup** — `git clone && npm ci && npm run dev`

Both require pre-installed tooling (Docker or Node.js). For a developer tool, the question is
whether we can offer a lower-friction path: a single downloadable binary or desktop app that
works out of the box.

This document surveys the options, evaluates effort and trade-offs, and makes a recommendation
for the next step.

## Key constraint: `better-sqlite3`

`better-sqlite3` is a **native C++ Node.js addon**. It compiles a platform-specific `.node`
binary against a specific Node.js ABI. Any packaging approach must handle this correctly —
and this is where most single-binary tools have friction.

## Options evaluated

### 1. `npm install -g` + `serve` command (recommended near-term)

**Effort:** ~2 days  
**Bundle size:** ~10 MB (npm package)  
**Native modules:** Work normally  
**Audience:** Developers (primary mcpscope audience)

mcpscope already has a `bin` entry in `package.json` pointing to the CLI. The gap is that
there's no `mcpscope serve` command that starts the backend, serves the pre-built frontend,
and opens the browser.

The backend already supports serving static files when `BACKEND_STATIC_DIR` is set
(`backend/src/app.ts` lines 120-133). The missing piece is:

- A CLI `serve` command that imports and starts the backend programmatically
- Bundling the compiled frontend assets (`vite build` output) into the npm package
- Auto-opening the browser via `open`/`start`/`xdg-open`

```bash
npm install -g mcpscope
mcpscope serve   # starts http://localhost:3030, opens browser
```

**Pros:**
- Zero new dependencies
- No packaging tooling to maintain
- Native modules (better-sqlite3) work without any special handling
- The target audience (developers) already has Node.js
- Builds on existing infrastructure

**Cons:**
- Requires Node.js to be installed (acceptable for developer tooling)
- Not a self-contained single binary
- No desktop-native features (tray, auto-update, native menus)

### 2. Node.js SEA (Single Executable Application)

**Effort:** ~1 week  
**Bundle size:** ~80 MB (includes Node.js runtime)  
**Native modules:** Fragile with better-sqlite3

Node.js 20+ has a built-in mechanism for single executables using
`--experimental-sea-config` + `postject`. You inject bundled JS into a `node` binary copy.

**The native-module problem:** SEA doesn't bundle `.node` files into the binary. You'd need
to either distribute the `.node` file alongside the executable (not truly single-file) or
replace `better-sqlite3` with a WASM-based SQLite driver (`sql.js`, `@sqlite.org/sqlite-wasm`).

The persistence layer in `backend/src/persistence/` is well-abstracted, so the swap surface
is known — but it's still non-trivial work with risk of behavioral differences.

**Verdict:** Doable but messy. The native module prevents a clean single-file result unless
we swap SQLite backends first.

### 3. Electron + electron-builder

**Effort:** ~2 weeks  
**Bundle size:** ~250 MB (includes Chromium + Node.js)  
**Native modules:** Handled via `electron-rebuild` (well-tested, reliable)

This is the production pattern used by **Open Design** (nexu-io/open-design), which has
the same stack: Electron + `better-sqlite3` + Node.js backend. They produce:

- macOS: `.dmg` (arm64 + x64) ~244-254 MB
- Windows: `.exe` (NSIS installer) + portable `.zip` ~276-312 MB
- Linux: AppImage (not currently distributed, has issues)

Electron main process would:
1. Spawn the Fastify backend as a child process on localhost:3030
2. Open a BrowserWindow to http://localhost:3030
3. Handle graceful shutdown on window close

Packaging with `electron-builder` produces platform-native artifacts from one config.

**Pros:**
- Single download, no Node.js required
- Native desktop packaging for all platforms
- Auto-update via `electron-updater` + GitHub Releases
- System tray for background MCP server
- Well-proven pattern (Open Design, VS Code, Slack, Discord)

**Cons:**
- ~250 MB download (Electron runtime is heavy)
- CI complexity: cross-platform builds, code signing, notarization
- Weekly dependency maintenance (Electron releases fast)
- The app is fundamentally a web UI — Electron wraps a browser around localhost:3030
- Overkill unless desktop-native features are needed

### 4. `pkg` (Vercel)

**Effort:** ~1 week  
**Bundle size:** ~80 MB  
**Native modules:** Supported via `assets` config, but brittle

`pkg` bundles Node.js code + runtime into a single binary. Has specific support for native
modules via the `assets` option, but resolution inside `pkg` binaries is notoriously
fragile across Node versions.

**Project status:** Maintenance mode (not actively developed). The ecosystem is moving
toward Node.js SEA.

**Verdict:** Higher risk than SEA for similar output. Not recommended for new work.

### 5. Tauri

**Effort:** Months (rewrite backend)  
**Bundle size:** ~10 MB  
**Native modules:** N/A

Tauri bundles a Rust binary + system webview. It would require rewriting the entire
Node.js/Fastify backend in Rust. Not a realistic option for mcpscope.

## Recommendation

### Immediate (next ~2 days): `mcpscope serve`

Add a `serve` command to the CLI that starts the backend + frontend from the npm package.
This is the smallest lift for the biggest UX improvement for our actual audience.

The work:
1. Ensure `vite build` output is included in the npm package's `files` array
2. Add a `serve` command to `cli/src/commands/` that imports and starts the backend
   server programmatically, pointing it at the bundled frontend static dir
3. Open `http://localhost:3030` in the default browser
4. Handle Ctrl-C / SIGTERM for clean shutdown

This delivers:
```bash
npm install -g mcpscope
mcpscope serve    # one command, everything works
```

### Medium-term: Evaluate WASM SQLite

If single-binary or Electron distribution becomes a priority, the blocker is
`better-sqlite3`. A WASM-based SQLite driver would:

- Enable clean Node.js SEA binaries
- Reduce Electron rebuild complexity
- Potentially work in more restricted environments (some Docker images, CI runners)

The persistence layer (`backend/src/persistence/`) is well-factored, making the swap
tractable. This should be evaluated separately with performance benchmarking, since
WASM SQLite can be slower than native for write-heavy workloads.

### Long-term: Electron only if desktop features are needed

If mcpscope grows features that genuinely need a desktop shell (background MCP server
in system tray, native notifications, auto-launch on login), then Electron is the right
choice. The pattern is proven (Open Design runs the same stack) and `electron-builder`
handles cross-platform packaging reliably.

But adopting Electron just for distribution — when the app is already a web UI and the
audience is developers — is adding complexity without solving a real pain point.

## Reference: Open Design packaging pattern

Open Design (nexu-io/open-design) has an identical tech stack and uses Electron:

| Aspect | Open Design | mcpscope |
|---|---|---|
| Backend | Express (Node.js) | Fastify (Node.js) |
| DB | better-sqlite3 | better-sqlite3 |
| Frontend | Custom web UI | Svelte + Vite |
| Desktop shell | Electron | None (proposed) |
| Packager | electron-builder | None (proposed) |
| Artifacts | .dmg, .exe, .zip | Docker + dev setup |

They also don't distribute Linux AppImage — the user noted issues with it. If we go the
Electron route, we should evaluate AppImage viability early.
