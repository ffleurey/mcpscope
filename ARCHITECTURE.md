# Architecture

## Purpose and product position

This project is a **backend-centered runtime and diagnostics tool**, not a generic chat UI. It is built for:

- developing and debugging MCP server workflows
- studying multi-turn LLM behavior
- inspecting reasoning, tool choice, and context growth
- exporting runs that can be replayed as deterministic regressions

The value of the project depends on correctness and inspectability:

- token accounting must attach to canonical runtime state
- reasoning history must be preserved for study
- context trimming rules must be explicit and testable
- raw LM/MCP exchanges must be retained for replay and debugging

## Documentation boundaries

- [DATA-MODEL.md](DATA-MODEL.md) — compact canonical runtime tree, public part taxonomy, canonical IDs, and lookup-model rules
- `ARCHITECTURE.md` — system design, persistence model, streaming model, replay model, and API overview

## Tech stack

**Backend:** Fastify + TypeScript, SQLite (better-sqlite3), LM Studio HTTP/SSE client, MCP HTTP client

**Frontend:** Svelte 5 + TypeScript + Vite — thin UI layer over backend-owned state, lives under `frontend/`

## Core architectural principles

- the backend owns the canonical runtime state
- SQLite is the canonical persistent store
- transcript and context are two views over the same runtime, not separate systems
- exported traces must stay replayable without reconstruction
- the frontend is a thin client over backend state
- raw exchanges are preserved for diagnostics, auditing, and replay

## Runtime state and persistence

The canonical runtime model is defined in [DATA-MODEL.md](DATA-MODEL.md).

The backend persistence layer stores the runtime as internal records:

- `SessionRecord`
- `TurnRecord`
- `RoundRecord`
- `PartRecord`
- `RawExchangeRecord`

These records are the source of truth for runtime behavior and replay.

The important rule is:

- mcpscope should have one canonical model across persistence, API, UI, and CLI
- provider-specific transport structures are normalized into that model at the integration boundary
- `RawExchangeRecord` belongs to the diagnostic and replay layer, not to the canonical runtime tree

## Transcript vs context

The system intentionally maintains two separate views of the same run.

**Transcript** — the full user-visible history, including reasoning blocks and tool activity needed for analysis.

**Context** — only what will be sent to the model on later turns.

This distinction is central to the product: rich diagnostics without polluting later prompt state.

Reasoning behavior:

- reasoning stays in transcript history for inspection and later study
- reasoning is stripped from later model-visible context after the turn completes
- multi-block reasoning within one turn is preserved in the order it was produced

## Streaming model

True reasoning/tool/content ordering is taken from streamed LM Studio SSE events, not guessed from a final merged completion response.

The runtime captures:

- reasoning deltas
- content deltas
- tool-call deltas
- final usage payloads

These are assembled into committed backend parts so multi-block reasoning inside a single tool-enabled turn remains inspectable.

### Internal LM Studio service-layer types

The LM Studio client layer has its own internal type hierarchy:

- **`LmStudioChatCompletionChunk`** — one raw SSE chunk
- **`LmStudioStreamDelta`** — one typed transient increment derived from a chunk
- **`LmStudioAssistantSegment`** — one fully assembled response block in true production order

These are internal service-layer concepts. They are not the public runtime tree.

### Normalization into the canonical model

The runtime receives provider-specific LM Studio streaming structures and normalizes them into mcpscope parts.

| LM Studio segment kind | Canonical part type |
|---|---|
| `reasoning` | `reasoning` |
| `content` | `assistant_answer` |
| `tool-call` | `tool_call` |

Additional canonical part types come from setup or user / MCP interactions rather than LM Studio completion segments:

- `system_prompt`
- `mcp_instructions`
- `tool_definitions`
- `user_prompt`

Tool-result details are included inside the canonical `tool_call` node rather than creating a separate canonical part type.

### The word "delta" at two layers

The word **delta** appears at two different layers:

- **`LmStudioStreamDelta`** — internal LM Studio assembly increment
- **domain delta** — transient backend-to-frontend streaming update such as `part-delta`

They are related, but they are not the same concept.

## Tool-enabled turns

- assistant tool calls and tool results are persisted canonically per round
- selectors reconstruct the correct model-visible messages from persisted parts
- tool-call/result transport details normalize into one canonical `tool_call` node

## Token accounting

The goal is not to force fake exactness where the upstream API does not provide it:

- use exact probe and prompt-delta data whenever derivable
- prompt-token probes are stored as first-class raw exchanges so accounting is auditable
- use proportional allocation only when the API exposes a grouped total rather than per-part totals

## API surface

**Session lifecycle:**

- `POST /api/sessions`
- `GET /api/sessions` — lightweight session summaries for the sidebar
- `DELETE /api/sessions/:sessionId`

**Turn execution:**

- `POST /api/sessions/:sessionId/turns` — synchronous, returns completed turn
- `POST /api/sessions/:sessionId/turns/stream` — SSE streaming

**Session inspection:**

- `GET /api/sessions/:sessionId/trace` — canonical full diagnostic payload, including derived transcript and context views
- `GET /api/lookup/:id` — compact lookup by canonical hierarchical ID

**Configuration (backend-owned CRUD):**

- LM connections
- model configs
- MCP profiles

**Other:**

- `GET /api/domain-model`
- `POST /api/traces/import` — persists an imported trace bundle as a normal backend session

## Frontend role

The frontend is a thin client over backend state. Its responsibilities:

- render backend trace snapshots
- initiate actions such as session creation and turn submission
- support trace export/import workflows
- expose inspect workflows over backend-owned IDs and lookup data

The frontend must not maintain its own parallel runtime model or re-implement runtime logic.

Key files:

- `frontend/src/lib/api/` — typed backend API client
- `frontend/src/lib/backendTypes.ts` — backend payload types
- `frontend/src/lib/connectionStore.ts` — backend CRUD for LM connections, model configs, MCP profiles
- `frontend/src/lib/sessionStore.ts` — session summaries, active trace loading, turn submission

### Streaming contract

1. The frontend keeps the latest backend trace snapshot in memory.
2. While a turn is live, the backend streams only small transient updates.
3. When a part is complete, the backend commits a canonical part and sends a `part-committed` event.
4. At round and turn boundaries the backend sends authoritative committed updates.

The frontend may hold a small in-memory overlay for currently streaming deltas, but it must discard that overlay as soon as committed backend parts arrive.

SSE event types emitted by `POST /api/sessions/:sessionId/turns/stream`:

1. `turn-started`
2. `round-started`
3. `part-delta`
4. `part-committed`
5. `round-committed`
6. `turn-committed`
7. `turn-failed`

### Import/export semantics

Export is the trace payload from `GET /api/sessions/:sessionId/trace`.

Import (`POST /api/traces/import`) takes the same shape and creates a persisted backend session. Imported traces are viewable through the same frontend code path as live sessions.

## Trace export and replay

The `/trace` endpoint is a product feature, not a testing hack. It exports the complete backend representation of a run:

- `session`, `turns`, `rounds`, `parts`, `rawExchanges`
- `transcript`, `context`

A captured run should be usable for debugging, support, analysis, and deterministic replay.

Replay happens at the backend runtime seam:

- feed recorded user turns
- replay recorded LM behavior
- replay recorded MCP behavior
- compare the resulting backend trace to the original

This keeps local regressions close to real runtime behavior without depending on live nondeterministic services. The replay harness lives at `backend/src/testing/replayHarness.ts`.

## Guiding constraints

- the canonical runtime tree is defined in [DATA-MODEL.md](DATA-MODEL.md)
- the backend remains the canonical source of truth
- SQLite remains the canonical store
- provider-specific transport structures must normalize into the canonical mcpscope model
- reasoning stays preserved in history even when stripped from later context
- the frontend may render transient deltas, but committed state always comes from the backend
- raw LM/MCP exchanges remain available for replay and debugging
