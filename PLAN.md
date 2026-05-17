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

### 1. CLI incremental rollout

The next active implementation track is the in-repo CLI.

- keep the CLI backend-driven and aligned with the same session model and canonical IDs as the UI
- v1 is now complete: CLI skeleton + `mcpscope sessions list`
- current focus is v2: one universal `mcpscope inspect <id>` command, built on `GET /api/lookup/:id`, with `--json` for JSON output and `--short` for summary mode
- CLI command reference: [CLI.md](CLI.md)
- add session creation only after the CLI skeleton and read-only inspection flow are in place
- defer true async turn lifecycle work until the backend contract for start/status/follow is specified

The active task description and rollout plan live in [backlog/cli-for-llm-in-the-loop-test.md](backlog/cli-for-llm-in-the-loop-test.md).

### 2. Token and context trust hardening

This remains the main quality gap beyond the CLI work.

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
