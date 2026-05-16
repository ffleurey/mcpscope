# Project status and near-term focus

## Current state

The project is in a usable backend-first shape:

- Fastify + TypeScript backend with SQLite as the canonical runtime store
- canonical runtime tree: `Session -> Setup + Turn[] -> Round[] -> Part[]`
- raw LM/MCP exchanges preserved separately for diagnostics and replay
- streamed LM Studio reasoning/content/tool-call capture persisted in order
- full trace export at `GET /api/sessions/:sessionId/trace`
- deterministic replay harness at `backend/src/testing/replayHarness.ts`
- thin Svelte frontend over backend-owned state, including session browsing and trace import/export

## What is stable enough to treat as current architecture

- backend-owned session execution, persistence, and profile management
- transcript/context split, with reasoning preserved for inspection but removed from later model-visible context
- SSE turn streaming based on committed backend parts rather than a parallel frontend runtime
- replayable trace export as both a product feature and a regression input

For the canonical runtime model and lookup vocabulary, use [DATA-MODEL.md](DATA-MODEL.md). For system behavior and API surface, use [ARCHITECTURE.md](ARCHITECTURE.md). For regression strategy, use [TESTING.md](TESTING.md).

## Main unresolved product work

### 1. Lookup/API contract convergence

This is the main active handoff task.

- align the lookup endpoint and frontend inspect flow with the canonical model in [DATA-MODEL.md](DATA-MODEL.md)
- finish the cleanup of the earlier overbuilt hierarchical lookup implementation
- keep the payload shape compact and avoid rebuilding extra documentation tooling around it

### 2. Token and context trust hardening

This remains the main quality gap beyond the lookup cleanup.

- verify token attribution against captured traces and live sessions
- ensure the context bar is driven by the same canonical state as trace export
- remove remaining mismatches between displayed statistics and backend truth

### 3. Frontend cleanup

- simplify session and turn state handling
- keep inspectability high without reintroducing frontend-owned runtime logic
- polish the MCP debugging workflow in compact and inspect views

### 4. Richer MCP analysis output

- support artifacts such as charts, tables, HTML fragments, and files
- keep large user-facing artifacts out of model context whenever possible
