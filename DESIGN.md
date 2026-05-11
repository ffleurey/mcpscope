# Current design

## Core principle

The backend is the canonical source of truth for runtime state.

The frontend should display and operate on backend state, not maintain its own parallel interpretation of the conversation.

## Canonical entities

The runtime is modeled through connected backend records:

- `Session`
- `Turn`
- `Round`
- `Part`
- `RawExchangeRecord`

That model is designed so the following stay connected:

- what the user sees in transcript history
- what the model sees in later context
- what tokens were attributed to each meaningful block
- what raw LM and MCP traffic produced those blocks

## Runtime vocabulary

The project uses one canonical hierarchy:

- **Turn** - one full user request lifecycle
- **Round** - one model iteration inside that turn
- **Part** - one committed canonical record inside a round or turn
- **Delta** - one transient streamed fragment before a part is committed

Important rule: a reasoning block, content block, tool call, or tool result is a **part**, not a round.

A round is usually composed of multiple parts. For example:

1. `assistant-reasoning`
2. `tool-call`
3. `tool-result`

Or:

1. `assistant-reasoning`
2. `assistant-content`

The LM Studio parser still uses the internal word **segment** while reconstructing streamed output, but that is not the canonical product vocabulary. The persisted domain term is **part**.

## Transcript vs context

The system intentionally separates two views of the same run:

### Transcript

The transcript preserves the full user-visible history, including reasoning blocks and tool activity needed for analysis.

### Context

The context view contains only what should be sent back to the model on later turns. Reasoning is removed from this view after the turn completes.

This distinction is central to the product: we want rich diagnostics without polluting later prompt state.

## Streamed capture

True reasoning/tool/content ordering is taken from streamed LM Studio events, not guessed from a final merged completion.

The runtime captures:

- reasoning deltas
- content deltas
- tool-call deltas
- final usage payloads

These are persisted as ordered parts so multi-block reasoning inside a single tool-enabled turn remains inspectable.

## Frontend streaming contract

The rewired frontend should render backend state directly and avoid building a second runtime model.

The simplest contract is:

1. the frontend keeps the latest backend trace snapshot in memory
2. while a turn is live, the backend streams only small **deltas**
3. when a reasoning/content/tool-call/tool-result unit is complete, the backend commits a canonical **part**
4. at least at round and turn boundaries, the backend sends an authoritative trace refresh or equivalent committed update

That means:

- **delta** = temporary streamed data
- **part** = canonical backend data

The frontend may hold a tiny in-memory overlay for currently streaming deltas, but it must discard that overlay as soon as committed backend parts arrive.

### Streaming transport

Use **Server-Sent Events (SSE)** for the first streaming implementation.

Why:

- backend -> frontend streaming is the immediate need
- the flow is naturally append-only and ordered
- it avoids introducing a bidirectional protocol before it is needed

### Non-streaming session contract

The minimal backend contract for the rewired frontend should be:

- `GET /api/sessions` - return lightweight session summaries for the sidebar
- `POST /api/sessions` - create a session
- `DELETE /api/sessions/:sessionId` - delete a session
- `GET /api/sessions/:sessionId/trace` - return the canonical detailed session payload
- `POST /api/sessions/:sessionId/turns` - create a turn and return the completed result

Configuration should also move to backend-owned CRUD surfaces:

- LM connections
- model profiles
- MCP profiles

### Session summary shape

`GET /api/sessions` should stay intentionally small. It should return only what the UI needs for navigation and selection, for example:

- session identity and title
- status / init status
- created / updated timestamps
- model and MCP profile labels needed for display
- optional latest-turn summary if useful for the sidebar

It should **not** duplicate the full trace shape.

### Trace detail shape

`GET /api/sessions/:sessionId/trace` remains the canonical detailed payload:

- `session`
- `turns`
- `rounds`
- `parts`
- `rawExchanges`
- `transcript`
- `context`

The frontend should derive lightweight view selectors from that shape, but should not create a second canonical chat model.

### Streaming event contract

The first streaming endpoint should follow the same backend vocabulary and carry only what is needed for live updates:

`POST /api/sessions/:sessionId/turns/stream`

Recommended event types:

1. `turn-started`
2. `round-started`
3. `part-delta`
4. `part-committed`
5. `round-committed`
6. `turn-committed`
7. `turn-failed`

Recommended semantics:

- `part-delta` carries only transient text/tool-call deltas for the currently open part
- `part-committed` carries the committed canonical part record
- `round-committed` may carry a compact canonical refresh for that round or the full updated trace
- `turn-committed` carries the final authoritative trace snapshot for the turn

The simplest implementation path is:

1. start with `POST /turns` + `GET /trace` refresh
2. add SSE streaming
3. keep the same trace backbone for both modes

### Import/export semantics

Export is simply the trace payload.

Import should use the same shape and create a persisted backend session rather than a frontend-only temporary object.

Recommended direction:

- `POST /api/traces/import`
- request body: full trace bundle
- result: imported backend session / trace reference

Imported traces should be viewable through the same frontend code path as live sessions.

## Token accounting

The design goal is not to force fake exactness where the upstream API does not provide it. The rules are:

- use exact probe and prompt-delta data whenever derivable
- persist probe requests and responses so accounting is auditable
- use proportional allocation only when the API exposes a grouped total rather than per-part totals

## Trace export

The trace endpoint exports the complete backend representation of a run:

- session
- turns
- rounds
- parts
- raw exchanges
- transcript
- context

This is a product feature, not a testing hack. A captured run should be usable for debugging, support, analysis, and deterministic replay.

## Replay strategy

Replay happens at the backend runtime seam:

- feed recorded user turns
- replay recorded LM behavior
- replay recorded MCP behavior
- compare the resulting backend trace to the original

That keeps local regressions close to real runtime behavior without depending on live nondeterministic services.

## Current architectural direction

Backend design is now in a good enough state to build on. The next design task is to simplify the frontend around these backend surfaces rather than adding more logic on the client side.
