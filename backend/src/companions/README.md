# Bundled companion MCP servers

Small, zero-config MCP servers shipped inside mcpscope so a new user can run a real
tool-calling experiment immediately — no external server to install, no keys to obtain.
They also serve as an out-of-the-box evaluation set and as a reference for good MCP tool
design.

## How they run

Each companion is an `@modelcontextprotocol/sdk` `McpServer` mounted in-process on the
mcpscope Fastify app over Streamable HTTP at `/companions/<name>/mcp`, via the shared
`registerStreamableHttpMcp` helper (same stateless mount path as mcpscope's own `/mcp`).
`registerCompanionServers(app, { host, port })` (called from `app.ts`) mounts them and
registers a provider that synthesizes one read-only built-in profile per companion
(`builtin-<name>`), so they appear in the selectable MCP-server list with no configuration
and are reachable by external MCP clients too.

## Good-citizen rules

- Only sources that are explicitly open to bots (fair-use). No grey-zone/paywalled APIs.
- Every upstream request sends a real `User-Agent` (`shared/http.ts`) and a timeout.
- Optional free-tier API keys (for key-gated companions) come from a `companions` section
  in the mcpscope config file — never a GUI.

## The servers

| Name | Data shape | Auth | Tools |
|---|---|---|---|
| `openMeteo` | numeric time-series | none | `geocode_place`, `get_current_weather`, `get_forecast`, `get_historical_weather` |
| `hackernews` | tech news feed + threads | none | `get_stories`, `search_stories`, `get_item` |
| `wikipedia` | long-form knowledge | none | `search`, `get_summary`, `get_article` |
| `worldbank` | economics / development stats | none | `search_indicators`, `get_indicator`, `list_countries` |
| `webfetch` | arbitrary page → readable text | none | `fetch_url` (robots + SSRF guarded) |
| `guardian` | general / world news | **free key** | `search_articles`, `get_article` |
| `websearch` | web search results | **free key** | `web_search` (Brave; pairs with `webfetch`) |

Each `<name>/README.md` has the per-server tool details and upstream attribution.

## Adding a new one

See **[ADDING-A-COMPANION.md](ADDING-A-COMPANION.md)** for the step-by-step: the pattern, which
existing server to copy, and the exact (short) list of files to touch. A keyless companion is one
new folder plus one line in `registry.ts`.

## Layout

- `shared/` — `http.ts` (User-Agent + `fetchJson` + timeout), `tool.ts`
  (`registerJsonTool` + `response_format` enum).
- `registry.ts` — the `COMPANIONS` list + `CompanionDefinition` (a factory taking a
  `CompanionContext` with the resolved upstream `apiKey`).
- `index.ts` — `registerCompanionServers` (mounts each server, resolves its key per request)
  plus built-in profile synthesis (with `disabledReason` for a key-gated companion whose key
  is unset).
- `<name>/` — one folder per server (`server.ts` factory + `README.md` with upstream
  attribution; `webfetch` also has `ssrf.ts` + `robots.ts`).

## Key-gated companions

`guardian` and `websearch` (Brave) need a free API key, supplied via a `companions` section in
the mcpscope config file — never a GUI:

```jsonc
"companions": {
  "guardian": { "api_key": "your-key-here" },
  "brave":    { "api_key": "your-key-here" }
}
```

Until the key is set, the companion is still **listed** but its built-in profile carries a
`disabledReason` naming the config key to set. Keyless companions are always enabled.

Servers are intentionally thin (~1:1 with each upstream API) and tuned to be usable by
small local models, not maximally optimized; some tools are deliberately token-heavy to
give mcpscope something interesting to show.
