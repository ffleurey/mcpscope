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
- packaged CLI shipped in the same product distribution and backed by the same canonical session model and IDs as the UI/API

For the canonical runtime model and lookup vocabulary, use [DATA-MODEL.md](DATA-MODEL.md). For system behavior and API surface, use [ARCHITECTURE.md](ARCHITECTURE.md). For regression strategy, use [TESTING.md](TESTING.md).

## Main unresolved product work

### 1. CLI next iteration and interface discipline

The CLI lifecycle MVP is now shipped and packaged in the Docker image. The next work is to improve the CLI incrementally without introducing contract drift.

- keep the CLI backend-driven and aligned with the same session model and canonical IDs as the UI
- v1 complete: `mcpscope sessions list`
- v2 complete: `mcpscope inspect <id>` — universal lookup by hierarchical ID, `--json`, `--short`
- v3 now adds the non-streaming lifecycle loop: `list`, `create`, `send`, `status`
- the Docker image now packages the CLI and supports the one-container `docker run` + `docker exec` workflow
- CLI command reference: [CLI.md](CLI.md)
- session creation now uses backend-owned defaults rather than CLI-side snapshot construction
- detached turn start and pollable session status are now part of the documented backend contract
- next: improve follow/help UX and defer streaming, interactive mode, and richer follow/cancel workflows
- any future MCP interface should mirror the same operation definitions and machine-readable contracts as the CLI rather than define a second agent-facing surface by hand

The completed Docker CLI packaging task lives in [backlog/done/cli-packaging-and-tutorial.md](backlog/done/cli-packaging-and-tutorial.md). The completed execution-lock task lives in [backlog/done/global-session-execution-lock.md](backlog/done/global-session-execution-lock.md). The next CLI feature task lives in [backlog/cli-next-iteration.md](backlog/cli-next-iteration.md), and the future sequential experiment task lives in [backlog/session-batch-runs.md](backlog/session-batch-runs.md).

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
