# Architecture

## Purpose and product position

This project is a **backend-centered runtime and diagnostics tool**, not a generic chat UI. It is built for:

- developing and debugging MCP server workflows
- studying multi-turn LLM behavior
- inspecting reasoning, tool choice, and context growth
- exporting runs that can be replayed as deterministic regressions

The value of the project depends on correctness and inspectability:

- token accounting must be attached to canonical runtime state
- reasoning history must be preserved for study
- context trimming rules must be explicit and testable
- raw LM/MCP exchanges must be retained for replay and debugging

## Tech stack

**Backend:** Fastify + TypeScript, SQLite (better-sqlite3), LM Studio HTTP/SSE client, MCP HTTP client

**Frontend:** Svelte 5 + TypeScript + Vite — thin UI layer over backend-owned state, lives under `frontend/`

## Canonical data model

The backend stores the runtime as five connected entity types:

- `Session` — one persisted conversation workspace
- `Turn` — one full user request lifecycle
- `Round` — one model iteration within a turn
- `Part` — one committed canonical unit within a round or turn
- `RawExchangeRecord` — one captured LM Studio or MCP request/response record

The key design principle: transcript data, context data, token metadata, and raw diagnostics all live on the same model instead of being rebuilt from separate ad hoc state. This is what makes the project inspectable and replayable.

## Runtime vocabulary

- **Turn** — one full user request lifecycle
- **Round** — one model iteration inside a turn
- **Part** — one committed canonical record inside a round or turn
- **Delta** — one transient streamed fragment before a part is committed

Important rule: a reasoning block, content block, tool call, or tool result is a **part**, not a round. A round is composed of multiple parts. For example:

```
assistant-reasoning → tool-call → tool-result
```

or:

```
assistant-reasoning → assistant-content
```

Full list of part types (from the domain model):

- `system-prompt`
- `mcp-instructions`
- `tool-definitions`
- `user-message`
- `assistant-reasoning`
- `assistant-content`
- `tool-call`
- `tool-result`
- `diagnostic-note`

Note: the LM Studio streaming parser uses the internal term **segment** while reconstructing streamed output. That is an implementation detail. The canonical persisted term is always **part**.

## Transcript vs context

The system intentionally maintains two separate views of the same run.

**Transcript** — the full user-visible history, including reasoning blocks and tool activity needed for analysis. This is what the user inspects.

**Context** — only what will be sent to the model on later turns. Reasoning is removed from this view after the turn completes.

This distinction is central to the product: rich diagnostics without polluting later prompt state.

Reasoning behavior:

- reasoning stays in transcript history for inspection and later study
- reasoning is stripped from later model-visible context after the turn completes
- multi-block reasoning within one turn is preserved in the order it was produced

## Streamed capture

True reasoning/tool/content ordering is taken from streamed LM Studio SSE events, not guessed from a final merged completion response. The runtime captures:

- reasoning deltas
- content deltas
- tool-call deltas
- final usage payloads

These are persisted as ordered parts so multi-block reasoning inside a single tool-enabled turn remains inspectable.

## LM Studio streaming model

The LM Studio client layer has its own type hierarchy that is distinct from the canonical domain model. Understanding the mapping is important when reading the runtime code.

### Types at the LM Studio service layer

**`LmStudioChatCompletionChunk`** — one raw SSE chunk from the streaming API. The lowest-level unit; carries partial increments for reasoning content, text content, or tool-call construction.

**`LmStudioStreamDelta`** — one typed in-process delta derived from a chunk, emitted via `onDelta` callbacks during streaming:

- `{ kind: 'reasoning', textDelta: string }` — a fragment of reasoning text
- `{ kind: 'content', textDelta: string }` — a fragment of response content
- `{ kind: 'tool-call', toolCallIndex, idDelta?, nameDelta?, argumentsDelta? }` — a partial tool-call increment

These are transient: they drive live frontend updates and are not persisted directly.

**`LmStudioAssistantSegment`** — one fully assembled output block within a completion response, produced by accumulating all deltas of the same kind:

- `{ kind: 'reasoning', text: string }` — the complete reasoning text block
- `{ kind: 'content', text: string }` — the complete response content block
- `{ kind: 'tool-call', toolCallIndex: number }` — a reference to a fully assembled tool call

A single completion response yields an ordered `LmStudioAssistantSegment[]`. This list captures the true production order of blocks (e.g., reasoning before content, multiple reasoning/content/tool-call blocks across rounds). Segments are stored as a JSON blob in `RoundRecord.responseTraceJson` for diagnostic inspection but are **not first-class persisted entities**.

### How segments map to parts

The runtime processes `LmStudioAssistantSegment[]` to produce `PartRecord[]`:

| LM Studio segment kind | Domain part type |
|---|---|
| `reasoning` | `assistant-reasoning` |
| `content` | `assistant-content` |
| `tool-call` | `tool-call` |

Part types with **no corresponding LM Studio segment** — they come from session setup or MCP interactions, not from completion responses:

- `system-prompt`
- `mcp-instructions`
- `tool-definitions`
- `user-message`
- `tool-result`
- `diagnostic-note`

### The word "delta" at two different layers

The word *delta* appears at two layers with different meanings:

**`LmStudioStreamDelta`** — an increment inside the LM Studio client while assembling a streaming response. Internal to the service layer; carries raw character-level text fragments. Not part of the domain vocabulary.

**Domain `Delta`** (the `part-delta` SSE event sent to the frontend) — a transient update sent from the backend to the frontend while a part is being assembled. The frontend discards this as soon as the corresponding `part-committed` event arrives.

These are not the same concept. `LmStudioStreamDelta` feeds into segment assembly inside the runtime. The domain `Delta` is a frontend notification built on top of the committed part model.

## Tool-enabled turns

- assistant tool calls and tool results are persisted canonically per round
- grouped tool calls remain analyzable as individual parts
- selectors reconstruct the right model-visible messages from those parts

## Token accounting

The goal is not to force fake exactness where the upstream API does not provide it:

- use exact probe and prompt-delta data whenever derivable
- prompt-token probes are stored as first-class raw exchanges so accounting is auditable
- use proportional allocation only when the API exposes a grouped total rather than per-part totals

## Persistence

SQLite is the runtime source of truth. The database stores:

- sessions, turns, rounds, parts, raw exchanges
- profile snapshots (LM connections, model configs, MCP profiles)

## API surface

**Session lifecycle:**

- `POST /api/sessions`
- `GET /api/sessions` — lightweight session summaries for the sidebar (not full traces)
- `DELETE /api/sessions/:sessionId`

The session summary shape is intentionally small: session identity and title, status / init status, created / updated timestamps, model and MCP profile labels needed for display, and an optional latest-turn summary. It does not duplicate the full trace shape.

**Turn execution:**

- `POST /api/sessions/:sessionId/turns` — synchronous, returns completed turn
- `POST /api/sessions/:sessionId/turns/stream` — SSE streaming

**Session inspection:**

- `GET /api/sessions/:sessionId/transcript`
- `GET /api/sessions/:sessionId/context`
- `GET /api/sessions/:sessionId/trace` — canonical full payload, the most important diagnostic endpoint

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
- initiate actions (create session, submit turn)
- support trace export/import workflows

The frontend must not maintain its own parallel runtime model or re-implement runtime logic.

Key files:

- `frontend/src/lib/api/` — typed backend API client
- `frontend/src/lib/backendTypes.ts` — backend payload types
- `frontend/src/lib/connectionStore.ts` — backend CRUD for LM connections, model configs, MCP profiles
- `frontend/src/lib/sessionStore.ts` — session summaries, active trace loading, turn submission

### Streaming contract

1. The frontend keeps the latest backend trace snapshot in memory.
2. While a turn is live, the backend streams only small **deltas**.
3. When a part is complete, the backend commits a canonical **part** and sends a `part-committed` event.
4. At round and turn boundaries the backend sends authoritative committed updates.

The frontend may hold a small in-memory overlay for currently streaming deltas, but must discard that overlay as soon as committed backend parts arrive.

SSE event types emitted by `POST /api/sessions/:sessionId/turns/stream`:

1. `turn-started`
2. `round-started`
3. `part-delta` — transient text/tool-call delta for the currently open part
4. `part-committed` — the committed canonical part record
5. `round-committed` — compact canonical refresh for that round
6. `turn-committed` — the final authoritative trace snapshot for the turn
7. `turn-failed`

### Import/export semantics

Export is the trace payload from `GET /api/sessions/:sessionId/trace`.

Import (`POST /api/traces/import`) takes the same shape and creates a persisted backend session. Imported traces are viewable through the same frontend code path as live sessions.

## Trace export and replay

The `/trace` endpoint is a **product feature, not a testing hack**. It exports the complete backend representation of a run:

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

- backend remains the canonical source of truth
- SQLite remains the canonical store
- trace export must stay replayable without reconstruction
- reasoning stays preserved in history even when stripped from later context
- vocabulary stays standardized as **Turn → Round → Part → Delta**
- the frontend may render transient deltas, but canonical state always comes from committed backend parts
