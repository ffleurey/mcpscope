# Bundled companion MCP servers

mcpscope ships a small set of **zero-config MCP servers** so you can run a real tool-calling
experiment the moment you start the app — no external server to install, and (mostly) no keys to
obtain. They double as an out-of-the-box evaluation suite for watching a small model reason over
different data shapes, and as a reference for good MCP tool design.

They are part of mcpscope: launched with it, exposed on its API, and pre-registered as selectable
MCP profiles with no setup.

## The servers

| Name | Data shape | Key | Tools |
|---|---|---|---|
| Open-Meteo Weather | numeric time-series | none | `geocode_place`, `get_current_weather`, `get_forecast`, `get_historical_weather` |
| Hacker News | tech news feed + threads | none | `get_stories`, `search_stories`, `get_item` |
| Wikipedia | long-form knowledge | none | `search`, `get_summary`, `get_article` |
| World Bank Data | economics / development stats | none | `search_indicators`, `get_indicator`, `list_countries` |
| Web Fetch | any page → readable text | none | `fetch_url` (robots.txt + SSRF guarded) |
| The Guardian | general / world news | **free key** | `search_articles`, `get_article` |
| Web Search | web search results | **free key** | `web_search` (Brave) |

The five keyless servers are always on. The two key-gated ones appear in the list but stay
**disabled** until you add a free API key (see [API keys](#api-keys)).

## Using them

Each companion is surfaced as a built-in MCP profile named `… (built-in)` (id `builtin-<name>`).
They show up automatically in the MCP-server list in the Web UI and CLI — no profile to create.

- **In the Web UI:** on the *MCP Server Profiles* screen the built-ins appear alongside your own
  profiles with a **built-in** tag. They are read-only — you can test them, but not edit, delete,
  or set them as a session default. Select them per session from the launch dialog's *MCP servers*
  checkboxes.
- **From the CLI / MCP:** they appear in `mcpscope list_mcp_profiles` (and the
  `mcpscope_list_mcp_profiles` tool) tagged `[built-in]`, with `source` and `disabled_reason`
  fields in the JSON/tool output. Pass their id to `create` like any other profile — a profile
  whose key is unconfigured shows an `unavailable:` line and is refused at session creation.
- **From an external MCP client:** each is reachable over Streamable HTTP at
  `http://<host>:<port>/companions/<name>/mcp` (e.g. `http://localhost:3030/companions/open-meteo/mcp`).

The profile URL always tracks the host/port mcpscope is currently running on, so it never goes
stale.

## API keys

`The Guardian` and `Web Search` need a free API key. Keys are supplied through a `companions`
section in the mcpscope config file only (there is no GUI field for them) — they are the
companion→upstream-API credential, separate from any mcpscope→server auth.

The config file is `mcpscope.config.json` in the data directory: **`~/.mcpscope/mcpscope.config.json`**
by default (`/data/mcpscope.config.json` inside the Docker volume; `--data-dir` moves it). It is
strict JSON — no comments.

```json
"companions": {
  "guardian": { "api_key": "your-guardian-key" },
  "brave":    { "api_key": "your-brave-key" }
}
```

- **The Guardian** — free developer key at <https://open-platform.theguardian.com/access/>
  (Developer tier; the public `test` key works for light experimentation).
- **Web Search** — free key at <https://brave.com/search/api/> (free tier ~2,000 queries/month).

Until a key is set, that server's profile is listed but disabled, with a tooltip naming the exact
config key to add. Restart mcpscope (or start a new session) after editing the config file so the
key is picked up.

## What they teach

These servers are intentionally thin — roughly 1:1 with each upstream API, tuned to be usable by
small local models rather than maximally optimized. They dogfood mcpscope's own tool-design
advice: consolidated tools (one `get_stories(feed=…)` instead of six), teammate-quality
descriptions, and a `response_format` / `summary|full` switch where results can be large.

Some tools are deliberately **token-heavy** — a full Wikipedia article, an expanded Hacker News
comment tree, an hourly forecast, a Guardian article body. That is by design: flipping one
parameter and watching the context bar move is exactly the behavior mcpscope exists to make
visible.

Per-server details (endpoints, attribution, fair-use) live in each server's README under
`backend/src/companions/<name>/`. Forking mcpscope to add your own zero-config server? The
step-by-step is in
[`backend/src/companions/ADDING-A-COMPANION.md`](backend/src/companions/ADDING-A-COMPANION.md) — a
keyless companion is one new folder plus one line in the registry.

## Attribution & fair use

Companions are well-behaved, low-volume clients of open public APIs. Every upstream request sends
a descriptive `User-Agent` identifying mcpscope and honors each source's fair-use policy; Web Fetch
additionally honors robots.txt (allowing the fetch if robots.txt itself is unreachable) and
refuses private/loopback addresses. Data belongs to its
respective source (Open-Meteo, Hacker News, Wikipedia, the World Bank, The Guardian, Brave) under
each one's license/terms.
