# CLI for LLM-in-the-Loop Testing — v3 session creation

This file now tracks the **next active CLI increment**.

The completed first increment is recorded in:

- [backlog/done/cli-v1-sessions-list.md](done/cli-v1-sessions-list.md)
- [backlog/done/cli-v2-inspect-command.md](done/cli-v2-inspect-command.md)

For the current CLI command reference, see [CLI.md](../CLI.md).

## Goal

Build the next CLI increment for **session creation**, so an agent can create and initialize a session without manually constructing backend snapshot payloads.

## Foundation

This increment builds on two completed prerequisites:

1. hierarchical IDs and lookup groundwork:
   - [backlog/done/hierachical-ids-system-and-api.md](done/hierachical-ids-system-and-api.md)
2. CLI skeleton + `sessions list`:
   - [backlog/done/cli-v1-sessions-list.md](done/cli-v1-sessions-list.md)
3. universal inspect command:
   - [backlog/done/cli-v2-inspect-command.md](done/cli-v2-inspect-command.md)

The CLI remains:

- an in-repo entrypoint exposed as **`mcpscope`**
- backend-driven
- installed and versioned with the backend
- rooted in the top-level `cli/` folder

## Current API reality

The shipped read-only CLI is now:

- `mcpscope sessions list`
- `mcpscope inspect <id>`

Session creation remains the next gap.

Current backend state:

- `POST /api/sessions` still requires full inline snapshots
- session initialization is still a separate step:
  - `POST /api/sessions/:sessionId/initialize`
- preflight support exists through:
  - `POST /api/sessions/preflight`

That means the next increment may require backend API work, unlike v2.

## Active scope

Design and implement the first session-creation command:

- `mcpscope sessions create`

The command should let the caller create a usable session without manually assembling `modelProfileSnapshot` and `mcpProfileSnapshot` objects.

## Preferred direction

The preferred CLI contract is ID-based, not snapshot-based.

Desired caller experience:

- choose a model config by ID
- optionally choose an MCP profile by ID
- create the session
- initialize it as part of the same command flow
- fail clearly if dependencies are unavailable

The CLI should not require the user to know backend snapshot internals.

## Error handling expectations

Session creation should be **blocking** from the CLI perspective.

If initialization fails:

- the command should fail
- the error should be explicit and actionable
- no dead or half-created session should be left behind

Structured error information should remain agent-friendly and include at least:

- `code`
- `stage`
- `retryable`
- `suggestion`

## What should not be included yet

Still out of scope for this increment:

- turn execution
- replay
- compare
- async job control
- cancellation
- broad configuration management

## Candidate command shape

The likely command shape is:

1. `mcpscope sessions create --model-config <id> [--mcp-profile <id>] [--session-id <id>]`

Exact flag naming can still be refined, but the command should remain:

- explicit
- non-interactive by default
- scriptable
- aligned with the backend-owned configuration model

## Increment plan

### 1. Decide backend contract

- decide whether to add a new backend endpoint that accepts config/profile IDs directly
- or decide whether the CLI should fetch existing configs and compose snapshots itself

The preferred option is a backend-supported ID-based creation flow.

### 2. Define command contract

- settle the `sessions create` flags
- define text and JSON success output
- define initialization failure output

### 3. Implement creation flow

- add backend support if needed
- implement CLI command
- keep help text and examples aligned

### 4. Final consistency pass

- keep docs/specs aligned with the shipped behavior
- confirm no accidental API drift was introduced
- keep the repo green
