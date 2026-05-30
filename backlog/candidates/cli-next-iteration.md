# CLI next iteration

This candidate tracks a plausible future CLI increment after the shipped v3 session lifecycle MVP.

Completed CLI increments:

- [backlog/completed/cli-v1-sessions-list.md](../completed/cli-v1-sessions-list.md)
- [backlog/completed/cli-v2-inspect-command.md](../completed/cli-v2-inspect-command.md)
- [backlog/completed/cli-v3-session-lifecycle-mvp.md](../completed/cli-v3-session-lifecycle-mvp.md)

The current shipped CLI reference remains [CLI.md](../CLI.md).

## Goal

Build the next layer on top of the current scriptable lifecycle CLI without regressing the simple polling workflow already delivered.

## Current shipped baseline

The CLI already supports:

1. `mcpscope list`
2. `mcpscope create <title>`
3. `mcpscope send <session-id> <prompt>`
4. `mcpscope status <session-id>`
5. `mcpscope inspect <id>`

The backend already supports:

- defaults-based session creation
- detached turn start for non-streaming polling
- session-centric lifecycle status

## Potential future scope

The next increment should focus on **richer lifecycle control**, not on reworking the shipped v3 surface.

Priority items:

1. add a follow mode for active execution
   - either `mcpscope follow <session-id>`
   - or a `status --follow` style flow
2. add explicit cancellation semantics if backend/runtime behavior can support it cleanly
3. improve command-level help and discoverability so `create --help`, `send --help`, and similar flows explain their own arguments instead of only showing the top-level usage

## Constraints

- keep the CLI backend-driven
- preserve current defaults-based session creation for the MVP path
- do not require the CLI to assemble model/MCP snapshots itself
- keep the existing polling workflow stable and scriptable

## Deferred features that must not be lost

These were explicitly deferred from the v3 task and remain valid future CLI work:

- streaming output
- interactive mode / REPL
- replay
- compare
- CLI configuration management
- CLI discovery commands for models or MCP profiles
- explicit CLI `--model-config` / `--mcp-profile` selection
- support for multiple MCP profiles per session

## Likely later split after the next increment

To keep the CLI manageable, the remaining work will probably need to stay split into separate tasks:

1. lifecycle control and follow UX
2. model/MCP discovery and explicit selection
3. replay / compare workflows
4. multi-MCP session support
