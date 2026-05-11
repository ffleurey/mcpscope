# AI Client App

Local-first tooling for **LLM chat, MCP server work, trace inspection, and replayable runtime analysis**.

The project is now organized around a **TypeScript backend as the source of truth** and a frontend that is being slimmed down into a UI layer. The backend owns runtime orchestration, persistence, token/context accounting, reasoning retention, raw exchange capture, and trace export.

## Current status

The first backend increment is complete:

- canonical backend model for sessions, turns, rounds, parts, and raw exchanges
- streamed LM Studio runtime with ordered reasoning/content/tool-call capture
- reasoning kept in transcript history but stripped from later model-visible context
- SQLite persistence for runtime state and diagnostics
- full session trace export at `/api/sessions/:sessionId/trace`
- deterministic replay harness that re-runs exported traces as local regression tests

The next stage is frontend rewiring so the UI becomes a thin client over the backend APIs.

## Architecture

### Backend

- Fastify + TypeScript
- SQLite runtime store
- LM Studio integration with streamed completions
- MCP HTTP client with raw request/response capture
- canonical runtime entities:
  - `Session`
  - `Turn`
  - `Round`
  - `Part`
  - `RawExchangeRecord`

### Frontend

- Svelte + TypeScript + Vite
- progressively moving toward presentation-only responsibilities
- should consume backend transcript, context, and trace data rather than re-implement runtime logic

## Runtime vocabulary

The project uses one canonical hierarchy:

- **Turn** - one full user request lifecycle
- **Round** - one model iteration inside that turn
- **Part** - one committed backend unit inside a round or turn
- **Delta** - one transient streamed fragment before a part is committed

Examples of part types include:

- `user-message`
- `assistant-reasoning`
- `assistant-content`
- `tool-call`
- `tool-result`

The LM Studio streaming parser still uses the internal word **segment** while reconstructing streamed output, but the persisted and documented canonical term is **part**.

## Trace and replay model

Every useful runtime artifact should be available from backend state, not reconstructed in tests:

- transcript-visible chat history
- model-visible context history
- ordered reasoning/content/tool/result parts
- raw LM Studio exchanges, including streamed payloads
- raw MCP exchanges
- prompt-token probe exchanges used for token attribution

That trace can then be exported and replayed through the backend test harness without guessing missing state.

For the rewired frontend, the same model remains canonical:

- the frontend renders the latest backend trace snapshot
- live streaming carries only **deltas**
- once the backend commits a **part**, that canonical backend structure replaces the transient delta state

## Token and reasoning rules

- prompt-side accounting prefers exact probe and delta-based attribution
- grouped totals are split proportionally only when the upstream API exposes an aggregate but not per-part counts
- reasoning is preserved in transcript history for analysis
- reasoning is stripped from later model-visible context after the turn completes
- multiple reasoning blocks inside a single tool-enabled turn are captured in order from the streamed response

## Development

```bash
npm run dev
npm run backend:dev
npm run frontend:dev
```

## Testing

```bash
npm test
npm run test:integration
```

- local tests cover pure logic, runtime behavior, app routes, and trace replay
- integration tests exercise the live LM Studio + MCP path and save traces that can later be promoted into replay fixtures

## Project docs

- `PROJECT.md` - project scope and product direction
- `PLAN.md` - current roadmap
- `DESIGN.md` - current system design
- `BACKEND.md` - backend runtime summary
- `TESTING.md` - test strategy
- `REFACTORING.md` - backend refactor closure summary
