# Project status and roadmap

## Current state

The project has reached a **first MVP shape**. The backend-first architecture is complete end-to-end and the frontend is a thin client over it.

What is in place:

- backend-owned runtime, persistence, and profile management (Fastify + TypeScript + SQLite)
- canonical runtime model: Session → Turn → Round → Part → RawExchangeRecord
- streamed LM Studio completions with ordered reasoning/content/tool-call capture
- reasoning retained in transcript history, stripped from later model-visible context
- full session trace export at `GET /api/sessions/:sessionId/trace`
- deterministic replay harness at `backend/src/testing/replayHarness.ts`
- backend SSE streaming on the canonical trace contract
- backend-driven Svelte frontend: sessions sidebar, compact chat mode, inspect mode, trace import/export

**What still blocks calling it a trustworthy finished tool:**

Token counting and context bar visualization are not yet fully verified or hardened against the canonical backend trace.

## What was completed

### Backend runtime foundation

- Fastify + TypeScript backend added in-repo alongside the frontend
- SQLite persistence established as the canonical runtime store
- canonical runtime model implemented and covered by tests
- LM Studio integration: streamed completions, prompt-token probes persisted as raw exchanges
- MCP HTTP client with raw request/response capture

### Trustworthy runtime capture

- streamed reasoning/content/tool-call capture (ordering taken from SSE events, not reconstructed from a final merged response)
- reasoning retained in transcript, stripped from later model-visible context
- prompt-token probes stored as first-class raw exchanges for auditable token attribution
- full trace export and replay harness in place

### Testing foundation

- pure logic tests: token accounting, selectors/context reconstruction, LM Studio SSE parsing
- focused runtime/app tests: model-only turns, tool-enabled turns, session/transcript/context/trace endpoints
- trace replay tests using exported trace bundles as regression fixtures
- live integration suite that saves exported traces to `backend-data/test-artifacts/`

### Frontend rewiring

The frontend was rewritten as a thin client over the backend. Legacy browser-owned runtime removed:

- `frontend/src/lib/chatStore.ts` — browser-owned runtime (removed)
- `frontend/src/lib/db.ts` — IndexedDB persistence (removed)
- browser-side LM Studio and MCP runtime clients (removed)

What replaced it:

- typed backend API client under `frontend/src/lib/api/`
- backend payload types in `frontend/src/lib/backendTypes.ts`
- `frontend/src/lib/connectionStore.ts` — backend CRUD for LM connections, model configs, MCP profiles
- `frontend/src/lib/sessionStore.ts` — backend-driven session summaries, active trace loading, turn submission

Frontend behavior:

- the chat view defaults to a compact Zed-inspired surface; inspect mode keeps the richer trace hierarchy
- raw payload access (request / response / raw exchanges) lives inline at the round level
- session-level setup parts are visible without a separate inspector workflow
- the context bar renders backend `context`
- compact chat streaming handles the reasoning / tool activity / assistant content phase handoff
- live delta state is updated immutably so streamed content grows in real time
- active streaming keeps the transcript pinned to the bottom
- export is available from the active session header
- trace import is available from the sessions sidebar and opens imported traces through the same backend/session path as live sessions
- `turn-committed` events replace the live overlay so the backend trace remains canonical

## Open work

### Token and context trust hardening

This is the main open item before the project can be called a trustworthy tool.

- verify token attribution end-to-end against captured traces and live sessions
- confirm the context bar is driven by the same canonical token/context state as the backend trace
- fix any remaining token/context mismatches
- keep export and replay as first-class product features while improving confidence in displayed statistics

### Frontend cleanup and UX

- simplify state management around sessions and turns
- polish presentation for MCP debugging and data-analysis use cases
- keep trace inspection embedded in the main session view, reserve export for full-trace JSON

### MCP analysis features

- continue building MCP-focused analysis features on top of the trusted runtime foundation
- support richer artifact types in tool results (charts, tables, HTML fragments, files) out of model context
