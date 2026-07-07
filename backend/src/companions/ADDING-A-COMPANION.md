# Adding a companion MCP server

This is the step-by-step for adding another bundled companion, following the exact pattern the
existing seven use. It is written for contributors and for anyone forking mcpscope as a framework
to experiment with their own zero-config MCP servers.

If you only read one thing: **a new keyless companion is one new folder plus one line in
`registry.ts`.** Everything else — mounting, the selectable built-in profile, and the GUI/CLI/MCP
surfacing — is generic and happens for free.

## How it fits together

```text
registry.ts (COMPANIONS[])
      │  each entry = { name, title, description, requiresKey, createServer }
      ▼
index.ts · registerCompanionServers(app, {host, port})   ← called once from app.ts
      ├─ mounts each server at  POST|GET|DELETE /companions/<name>/mcp
      │     via registerStreamableHttpMcp (fresh McpServer per request)
      └─ registers a profile provider → companionProfiles()
               synthesizes one read-only ListedMcpServerProfile per companion
               (id "builtin-<name>", URL tracking host/port, disabledReason when key-gated)
      ▼
configStore.listMcpServerProfiles() merges built-ins ahead of user profiles
      ▼
one seam feeds every consumer: GUI list, CLI list_mcp_profiles,
MCP mcpscope_list_mcp_profiles, and session-creation resolution
```

Your server is just an `McpServer` factory. The registry entry is the only wiring you write.

## A keyless companion (the common case)

### 1. Create `backend/src/companions/<name>/`

Copy the shape of an existing server — **`openMeteo/`** is the simplest reference
(place-name → coordinates → data chaining, plus the `response_format` switch).

- **`server.ts`** — export a `createXServer(): McpServer` factory. Inside it, call
  `registerJsonTool(server, name, description, inputSchema, handler)` once per tool. Use the shared
  helpers (see [Shared helpers](#shared-helpers)); do upstream calls with `fetchJson`, and throw
  `CompanionError` for clean, model-facing failures.
- **`server.test.ts`** — copy any existing per-server test. It stubs `fetch`, connects a real MCP
  `Client` over `InMemoryTransport`, and asserts each tool's shape. No live network.
- **`README.md`** — the tools, the upstream endpoints, and an **attribution & fair-use** note.

### 2. Register it in `registry.ts`

Add one entry to `COMPANIONS`:

```ts
{
  name: "example",                       // URL-safe; becomes /companions/example/mcp + builtin-example
  title: "Example (built-in)",
  description: "One-line summary shown in the profile list.",
  requiresKey: null,                     // keyless
  createServer: createExampleServer,     // () => McpServer  (ctx is ignored when keyless)
},
```

### 3. Done — what you get for free

No other code changes are required. The generic machinery gives you:

- the Streamable-HTTP mount at `/companions/example/mcp`;
- a selectable `builtin-example` profile (URL tracks the live host/port, never stale);
- read-only treatment everywhere (GUI tag + disabled edit/delete/default; CLI `[built-in]` tag; MCP
  `source: "builtin"`) — enforced by the `builtin-` guard in `configStore.ts`;
- session-creation resolution by id.

## A key-gated companion (needs a free API key)

Follow the keyless steps, then:

### A. Take the key in your factory

```ts
export function createExampleServer(apiKey: string | null): McpServer { … }
```

Fail in-band when it is missing (see `guardian/server.ts` / `websearch/server.ts`): throw a
`CompanionError` naming the config key. Pass the key to `fetchJson` as a query param or header
(`fetchJson(url, { headers: { "x-api-key": apiKey } })`).

### B. Wire the registry entry to the key

```ts
{
  name: "example",
  title: "Example (built-in)",
  description: "…",
  requiresKey: "example",                       // must match the config section key below
  createServer: (ctx) => createExampleServer(ctx.apiKey),
},
```

`resolveApiKey()` in `index.ts` maps `requiresKey` → `companions.<requiresKey>.api_key`
generically, so **you do not touch `index.ts`.** When the key is unset, the profile is
automatically listed-but-disabled with a `disabledReason`, and session creation refuses it.

### C. Add the key to the config schema — `backend/src/config/configStore.ts`

The key lives in the config file only (no GUI). Add your section in these spots (grep `brave` to
see every one — mirror it):

1. `CompanionsConfig` interface — add `example: { api_key: string | null };`
2. `companionsConfigSchema` — add `example: companionKeySchema.default({ api_key: null }),`
3. `clearAll()` — add `example: { api_key: null }` to the reset object.
4. `loadFromParsed()` — add `example: { api_key: config.companions.example.api_key }`.
5. `getCompanionsConfig()` — add `example: { api_key: this.companions.example.api_key }`.

That is the whole surface. `disabledReason`, the disabled-with-tooltip UX, and the
`mcp_profile_disabled` session-creation guard are all generic.

## Shared helpers

- **`shared/http.ts`** — `COMPANION_USER_AGENT` (sent on every request), `fetchJson(url, { params,
  headers, timeoutMs })` (GET + JSON parse + timeout + clean errors), and `CompanionError`.
- **`shared/tool.ts`** — `registerJsonTool(...)` (validates args with the Zod `inputSchema`, renders
  the result as JSON text, maps thrown errors to `{ error: { message } }` with `isError`), and
  `responseFormatSchema` (the reusable `concise | detailed` enum).

## Design guidelines (dogfooding)

These servers are the reference for mcpscope's own advice — keep them teammate-quality (full detail
in [`../../../COMPANIONS.md`](../../../COMPANIONS.md)):

- **Flat schemas** — top-level primitives, enums, sane defaults; no nested arg objects.
- **Tight surface** — 2–4 tools; consolidate variants behind an enum (`get_stories(feed=…)`), don't
  ship near-duplicates.
- **Compact by default, verbose on demand** — expose `responseFormatSchema` (or a `summary|full`
  variant) where a payload can be large; keep `concise` the default. This is the "flip one
  parameter, watch the context bar move" demo, so token-heavy `detailed` output is a feature.
- **Strong docstrings** — say when to use / when not to / the result shape / the follow-up tool.
- **Paved paths** — return exact ids and derived URLs so the next call is obvious; timestamps as raw
  **and** ISO.

## Files checklist

| File | Keyless | Key-gated |
|---|---|---|
| `<name>/server.ts`, `<name>/server.test.ts`, `<name>/README.md` | add | add |
| `registry.ts` | 1 entry | 1 entry (with `requiresKey` + `ctx.apiKey`) |
| `config/configStore.ts` | — | add the key section (5 spots above) |
| `index.ts`, `mcp/streamableHttp.ts`, GUI, CLI, `operations/listConfigs.ts` | untouched | untouched |
| `../../../COMPANIONS.md` + `README.md` (this folder's server table) | update | update |

## Verify

```bash
npx vitest run backend/src/companions   # your test + the gating test
npm run check:backend && npm run lint:backend
npm run verify                          # full gate before a PR
```

Then try it live: it appears in the MCP-server list automatically — select `builtin-<name>` in a
session and watch a small local model use it (`mcpscope inspect <id>` / the trace view). Curl-verify
the real upstream response shapes while building; that is how the existing servers were shaped.
