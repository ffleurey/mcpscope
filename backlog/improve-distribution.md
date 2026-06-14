# Improve Distribution: Single-executable and desktop packaging

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
