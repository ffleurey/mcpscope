# CLI for LLM-in-the-Loop Testing

mcpscope should expose a **CLI-first interface** for automated LLM-in-the-loop testing of MCP servers.

The primary user is **a coding agent or script**, not an end user. The CLI is the non-interactive companion to the UI: the UI is for human visual inspection, the CLI is for low-token, structured inspection and automation.

## Goal

Allow an agent or test script to run MCP evaluation sessions, inspect only the relevant parts of the trace, and iterate quickly on prompts, tool descriptions, and schemas.

## Status and foundation

The hierarchical ID and lookup prerequisite is complete. The CLI should build on the groundwork documented in **`backlog/done/hierachical-ids-system-and-api.md`**:

- shared canonical IDs across UI and CLI
- generic lookup by hierarchical ID
- summary-mode navigation across sessions, turns, rounds, and parts
- UI visibility and copyability of IDs

The CLI should reuse those primitives rather than redesigning them.

## Core direction

- the CLI is an in-repo mcpscope entrypoint exposed as **`mcpscope`**
- it uses the **same backend, same database, and same session model** as the UI
- it talks to the backend API, not the database directly
- it is installed, versioned, and distributed **with the backend**, not as a separate product
- default behavior is **summary first, detail on demand**
- structured output is a stable contract for scripts and agents
- authentication is **out of scope for v1**

This shared workspace is the point: sessions created in the UI should be inspectable from the CLI, sessions created in the CLI should be visible in the UI, and both human and agent should refer to the same session / turn / round / part IDs.

## Current backend reality

The current backend already supports a useful read-only CLI:

- `GET /api/sessions`
- `GET /api/sessions/:sessionId/trace`
- `GET /api/lookup/:id`

Those endpoints are enough for the first increment.

The backend does **not** yet fully support the long-term CLI vision:

- `POST /api/sessions` currently requires full inline `modelProfileSnapshot` and `mcpProfileSnapshot`
- session initialization is a separate step: `POST /api/sessions/:sessionId/initialize`
- turn execution is blocking or SSE-streaming, not a true durable async job model
- there is no dedicated turn status endpoint for polling by turn ID

That means the CLI should be implemented incrementally, starting with read-only inspection.

## Packaging and backend connection

The CLI is expected to work with a **locally running mcpscope backend** and should be treated as part of the same product distribution.

Structurally, that means:

- one repository
- one release workflow
- one versioned backend + frontend + CLI bundle
- no assumption that the CLI will become its own repo or independently useful package

The recommended implementation shape is:

- keep the CLI source in-repo under `cli/`
- keep it internal/private in product terms even if it has its own source boundary
- build and ship it together with the backend

If a simpler layout is preferred, the CLI can also live under `backend/src/cli/`. The important decision is shared distribution, not the exact folder.

Comparable project patterns and rationale are documented in [research/project-structure-for-cli-tool.md](../research/project-structure-for-cli-tool.md).

The CLI must also have explicit backend configuration:

- `--url <backend-url>`
- `MCPSCOPE_URL`

Resolution order:

1. `--url`
2. `MCPSCOPE_URL`
3. optional default local backend URL if we choose to define one

The CLI should never depend on implicit Docker-vs-native assumptions.

## IDs and inspection model

The CLI should reuse the canonical ID and inspection model already defined in [DATA-MODEL.md](../DATA-MODEL.md). This task should not restate or redefine the hierarchical ID scheme; it should only specify how the CLI uses those IDs in commands and outputs.

## Command inventory

The command structure must be explicit before implementation.

### V1: read-only commands using existing APIs

1. `mcpscope sessions list`
2. `mcpscope sessions show <session-id>`
3. `mcpscope inspect <hierarchical-id>`
4. `mcpscope sessions trace <session-id>`

This first increment should require **no backend changes**.

### V2: session creation

1. `mcpscope sessions create`

### V3: turn execution

1. `mcpscope turns run <session-id>`
2. `mcpscope turns follow <turn-id>`
3. `mcpscope turns status <turn-id>`
4. `mcpscope turns wait <turn-id>`
5. `mcpscope turns cancel <turn-id>`

Replay and compare are **not v1**. They deserve a separate follow-up spec instead of staying implicit inside the first CLI rollout.

## Session creation direction

Session creation should be **blocking** for the CLI: validation and initialization failures should be reported immediately, and a failed initialization should not leave a dead session behind.

The current API is not CLI-friendly enough because it requires full inline snapshots:

- `modelProfileSnapshot`
- `mcpProfileSnapshot`

The preferred direction is a backend-supported creation flow that accepts stable IDs instead:

- select a model config by ID
- optionally select an MCP profile by ID
- create and initialize the session server-side
- fail synchronously if initialization cannot complete

The fallback is for the CLI to fetch config objects and assemble snapshots itself, but that is weaker because it leaks backend internals into the CLI contract.

Initialization errors should be explicit and agent-friendly. Structured errors should include at least:

- `code`
- `stage`
- `retryable`
- `suggestion`

Recommended distinction:

- **initialization failure**: dependencies/config are not ready
- **runtime failure**: the session started correctly but later execution failed

## Turn lifecycle gap

The eventual CLI should support a long-running command model:

- **start**
- **status**
- **follow**
- **wait**
- **cancel**

For turns, the compact progress view should include:

- object ID
- status
- current round
- latest part ID
- tools called so far
- tokens used so far
- elapsed time

But the current backend does not yet support this model fully. Right now it supports:

- blocking turn execution
- SSE streaming while the client remains connected

It does **not** yet support:

- durable asynchronous turn jobs
- polling turn status later through a dedicated endpoint
- cancellation semantics

So turn commands should follow, not precede, the read-only CLI and session-creation work.

## Output, flags, and script safety

The CLI should be safe to script against.

### Output formats

All commands should support:

- `--format text`
- `--format json`
- `--format stream-json`

Rules:

- `json` writes one JSON object or array to stdout
- `stream-json` writes NDJSON to stdout
- structured modes must never mix plain text with JSON
- logs, warnings, and progress go to stderr
- structured output includes `api_version`

### Common automation flags

- `--no-input`
- `--yes`
- `--quiet`
- `--fields`
- `--limit`
- `--timeout`
- `--async`
- `--follow`
- `--dry-run`

When stdout is not a TTY, or when running in CI, the CLI should default to non-interactive behavior with no prompts, pagers, or ANSI-dependent progress UI.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | general error |
| 2 | usage error |
| 3 | initialization / dependency failure |
| 4 | runtime failure after successful start |
| 5 | timeout / partial / interrupted waiting |
| 130 | interrupted by SIGINT |

### Script-safety rules

- structured output is the stable contract
- human-readable output is not for scripts
- commands should validate eagerly, even in async mode
- validation failures should be synchronous
- interrupted runs should not remain stuck forever in `running`
- default list output should stay compact

## V1 scope

Included:

- in-repo CLI skeleton under `cli/`
- backend URL resolution
- stable text/json output handling
- read-only inspection of sessions and hierarchical IDs

Deferred:

- replay
- compare
- true async turn job control
- cancellation
- broad configuration management through the CLI

## Incremental implementation plan

### 1. Documentation and baseline cleanup

- keep the active CLI task as the main planning document
- remove stale references to earlier prerequisite work as still active
- keep the repo green before starting implementation

### 2. CLI skeleton

- create the `cli/` package/module
- add the executable entrypoint
- add backend URL resolution
- add shared output/flag handling
- add command registry, error handling, and exit-code plumbing

### 3. Read-only CLI v1

- implement `sessions list`
- implement `sessions show <session-id>`
- implement `inspect <hierarchical-id>`
- implement trace fetch commands for explicit deep inspection
- keep default output compact and summary-first

### 4. Session creation design

- define the backend contract for ID-based session creation
- decide whether creation and initialization become one blocking backend operation
- define structured initialization errors and CLI output shape

### 5. Session creation implementation

- add backend support if needed
- implement `sessions create`
- ensure failed initialization leaves no dead session behind

### 6. Turn lifecycle design

- specify realistic `run` / `status` / `follow` / `wait` / `cancel` semantics
- decide which backend endpoints are required
- avoid promising async job behavior before the backend supports it

### 7. Turn lifecycle implementation

- implement prompt submission commands
- add follow/status behavior once the backend contract exists
