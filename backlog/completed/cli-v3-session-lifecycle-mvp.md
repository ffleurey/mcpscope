# CLI v3 — session lifecycle MVP

This increment completed the first **non-streaming CLI lifecycle loop** for `mcpscope`.

Completed prerequisites:

- [cli-v1-sessions-list.md](cli-v1-sessions-list.md)
- [cli-v2-inspect-command.md](cli-v2-inspect-command.md)
- [session-creation-defaults.md](session-creation-defaults.md)

For the current shipped command reference, see [CLI.md](../../CLI.md).

## Delivered

### CLI surface

- added `mcpscope list`
- kept `mcpscope sessions list` as a compatibility alias
- added `mcpscope create <title> [--id <session-id>] [--compaction <strategy>]`
- added `mcpscope send <session-id> <prompt>`
- added `mcpscope status <session-id>`
- kept `mcpscope inspect <id>` as the universal read path
- kept shared connection handling:
  - `--url`
  - `MCPSCOPE_URL`
  - default `http://localhost:3030`

### Backend/API support

- added CLI-friendly defaults-based session creation
- kept snapshot-based session semantics
- added detached turn start with immediate return for polling workflows
- added a pollable session status endpoint with lifecycle mapping:
  - `initializing`
  - `ready`
  - `running`
  - `error`
- tightened detached turn start so the backend reserves turn IDs atomically before background execution

### Error contract

- documented and shipped defaults-based create errors:
  - `default_model_not_configured`
  - `default_model_config_not_found`
  - `default_lm_connection_not_found`
  - `default_mcp_profile_not_found`
  - `invalid_session_id`
  - `duplicate_session_id`
- documented and shipped send/status lifecycle errors:
  - `session_not_found`
  - `session_not_initialized`
  - `turn_in_progress`

## Behavior

- `create` returns as soon as the session record exists; initialization may still be in progress
- `create` relies on backend-owned defaults and does not construct snapshots in the CLI
- `send` starts one non-streaming turn and returns immediately with the turn ID
- `send` rejects immediately if the session is not ready; nothing is queued
- `status` is session-centric and exposes the active turn when relevant
- `inspect` remains the detailed follow-up path once a session or turn ID is known

## Important implementation notes

- defaults affect only new session creation; created sessions remain frozen snapshots
- the CLI stays backend-driven and shares the same canonical IDs as the UI
- the lifecycle MVP intentionally excludes streaming terminal output and interactive shell behavior
- backend regression coverage now includes concurrent detached-start protection

## Validation

- CLI, backend, lint, type-check, and test suites passed after the lifecycle follow-up fixes

## Follow-up

The next CLI task should build on this shipped base rather than reopening the v3 contract.

Deferred items from the v3 planning work that remain valid:

- streaming follow mode
- interactive mode / REPL-style workflow
- cancellation
- replay
- compare
- CLI configuration management
- CLI discovery commands for models or MCP profiles
- explicit CLI `--model-config` / `--mcp-profile` selection
- support for multiple MCP profiles per session
- command/help UX polish beyond the current top-level help
