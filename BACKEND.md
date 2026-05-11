# Backend summary

## Status

The first backend increment is **complete and usable**. The backend is now the canonical runtime layer for the project.

It owns:

- session and turn orchestration
- LM Studio interaction
- MCP interaction
- persistence
- token/context accounting
- reasoning retention rules
- trace export for replay and diagnostics

## Core model

The backend stores the runtime as connected canonical entities instead of side-car structures:

- `Session`
- `Turn`
- `Round`
- `Part`
- `RawExchangeRecord`

This is the key design decision behind the refactor: transcript data, context data, token metadata, and raw diagnostics live on the same model instead of being rebuilt from separate ad hoc state.

## Runtime vocabulary

The backend vocabulary is:

- **Session** - one persisted conversation workspace
- **Turn** - one full user request lifecycle
- **Round** - one model iteration within a turn
- **Part** - one committed canonical unit within a round or turn
- **Raw exchange** - one captured LM Studio or MCP request/response record

Examples of part types:

- `assistant-reasoning`
- `assistant-content`
- `tool-call`
- `tool-result`

The LM Studio client still uses the internal term **segment** while parsing streamed SSE deltas. That is an implementation detail. The canonical persisted unit is always a **part**.

## Runtime behavior

### Model interaction

- completions are requested from LM Studio through the streamed API
- streamed deltas are parsed and then committed as ordered reasoning/content/tool-call parts
- final usage payloads are captured when available

### Streaming boundary

For the rewired frontend, the intended contract is:

- stream only transient **deltas**
- commit canonical backend **parts** as soon as they are complete
- refresh authoritative backend trace state at round and turn boundaries

This keeps the frontend real-time without giving it its own competing runtime model.

### Reasoning retention

- reasoning stays in transcript history for inspection and later study
- reasoning is stripped from later model-visible context after the turn completes
- multi-block reasoning within one turn is preserved in the order it was produced

### Tool-enabled turns

- assistant tool calls and tool results are persisted canonically per round
- grouped tool calls remain analyzable as individual parts
- selectors reconstruct the right model-visible messages from those parts

### Token accounting

- prompt-token probes are stored as first-class raw exchanges
- prompt-side attribution prefers exact probe and delta-derived values
- proportional splitting is used only when upstream usage is only available as a grouped total

## Persistence

SQLite is the runtime source of truth for:

- sessions
- turns
- rounds
- parts
- raw exchanges
- profile snapshots

This gives the project a queryable and testable foundation that the frontend-only version never had.

## Main API surfaces

- `POST /api/sessions`
- `GET /api/sessions` *(planned for frontend rewiring)*
- `DELETE /api/sessions/:sessionId` *(planned for frontend rewiring)*
- `POST /api/sessions/:sessionId/turns`
- `POST /api/sessions/:sessionId/turns/stream` *(planned SSE endpoint)*
- `GET /api/sessions/:sessionId/transcript`
- `GET /api/sessions/:sessionId/context`
- `GET /api/sessions/:sessionId/trace`
- `GET /api/domain-model`

`/trace` is the most important diagnostic endpoint: it exports the complete backend view needed to replay a run locally.

For the rewired frontend:

- `GET /api/sessions` should return small session summaries, not full traces
- `GET /api/sessions/:sessionId/trace` should remain the canonical detailed payload
- the streaming endpoint should emit transient **deltas** and then committed **parts**
- trace import should persist imported traces as normal backend sessions

## Test position

The backend is covered through four layers:

1. pure logic and parser tests
2. focused runtime and app tests
3. trace replay tests using exported traces
4. thin live integration tests against LM Studio and the local MCP server

This is the foundation that should let the project evolve safely.

## Next backend-adjacent work

The next major step is **not another backend rewrite**. It is frontend rewiring:

- move the UI onto backend transcript/context/trace APIs
- stream backend-native deltas and replace them with committed parts
- remove remaining duplicated runtime logic from the frontend
- keep export and replay as first-class product features
