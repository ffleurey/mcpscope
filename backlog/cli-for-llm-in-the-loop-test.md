# CLI for LLM-in-the-Loop Testing — v3 session lifecycle MVP

This file tracks the **next active CLI increment**.

Completed increments:

- [backlog/done/cli-v1-sessions-list.md](done/cli-v1-sessions-list.md)
- [backlog/done/cli-v2-inspect-command.md](done/cli-v2-inspect-command.md)
- [backlog/done/session-creation-defaults.md](done/session-creation-defaults.md)

For the current shipped CLI reference, see [CLI.md](../CLI.md).

## Goal

Build the first **non-streaming CLI MVP** that can drive the basic loop from the terminal:

1. create a session
2. wait until it is ready
3. send a prompt
4. poll until the turn is finished
5. inspect the resulting session or turn

This increment does **not** include streaming output and does **not** include an interactive shell mode.

## Foundation

This work now depends on these completed prerequisites:

1. hierarchical IDs and lookup groundwork:
   - [backlog/done/hierachical-ids-system-and-api.md](done/hierachical-ids-system-and-api.md)
2. CLI skeleton + sessions list:
   - [backlog/done/cli-v1-sessions-list.md](done/cli-v1-sessions-list.md)
3. universal inspect command:
   - [backlog/done/cli-v2-inspect-command.md](done/cli-v2-inspect-command.md)
4. session creation defaults:
   - [backlog/done/session-creation-defaults.md](done/session-creation-defaults.md)

The CLI remains:

- an in-repo entrypoint exposed as **`mcpscope`**
- backend-driven
- installed and versioned with the backend
- rooted in the top-level `cli/` folder

## Current backend reality

What already exists:

- `GET /api/sessions`
- `GET /api/lookup/:id`
- `POST /api/sessions/preflight`
- `POST /api/sessions`
- `POST /api/sessions/:sessionId/initialize`
- `POST /api/sessions/:sessionId/turns`
- `POST /api/sessions/:sessionId/turns/stream`
- backend-owned session creation defaults

What is still missing for the CLI MVP:

- a clean default-based session creation contract for the CLI
- a non-streaming prompt submission path suitable for immediate return + polling
- a pollable session status view with a simple CLI-facing lifecycle state

## Defaults behavior

This is now an important prerequisite assumption and should be explicit in the CLI task.

### Source of defaults

Session creation defaults are managed by the backend and UI, not by the CLI.

Available defaults:

- one required **default model config**
- one optional **default MCP profile**

The CLI v3 task should assume those defaults already exist and are managed outside the CLI.

### How `create` uses defaults

When the CLI creates a session:

1. the backend reads the current session-creation defaults
2. it resolves the default model config
3. it resolves the optional default MCP profile if configured
4. it resolves the model config's LM connection
5. it builds frozen session snapshots from those resolved records
6. it creates the session

The CLI must **not** construct snapshots itself in v3.

### Snapshot semantics

Defaults influence only **new session creation**.

Once a session is created:

- the resolved model/MCP configuration is stored in the session snapshot
- later changes to defaults do **not** change that session
- later deletion or modification of reusable configs does **not** retroactively change existing sessions

### Error implications

`mcpscope create` must fail clearly when:

- no default model is configured
- the configured default model points to a missing model config
- the resolved model config points to a missing LM connection
- the configured default MCP points to a missing MCP profile

This matters because defaults are now part of the API contract, not just a UI convenience.

## Active scope

The v3 command inventory should stay intentionally small:

1. `mcpscope list`
2. `mcpscope create <title>`
3. `mcpscope send <session-id> <prompt>`
4. `mcpscope status <session-id>`

Together with the already shipped `mcpscope inspect <id>`, these commands should cover the automation loop without streaming or interactive mode.

Compatibility note:

- the already shipped `mcpscope sessions list` can remain as a compatibility alias
- the simplified `mcpscope list` can become the preferred top-level form if implemented in this increment

## Desired user experience

- list sessions with a short command
- create a session without specifying model or MCP IDs in the CLI
- rely on backend-owned defaults for session creation
- optionally override session ID
- optionally override compaction strategy
- get a clear error if defaults are not configured correctly
- send a prompt without streaming
- poll session state until the run is finished
- inspect details with `mcpscope inspect <id>`

## Out of scope

Still out of scope for v3:

- streaming output
- interactive mode / REPL
- replay
- compare
- cancellation
- CLI configuration management
- CLI discovery commands for models or MCP profiles
- explicit CLI `--model-config` / `--mcp-profile` selection
- multiple MCP profiles per session

## Candidate command surface

### `mcpscope list`

Read-only session listing.

### `mcpscope create <title> [--id <session-id>] [--compaction <strategy>]`

Create a session using backend-owned defaults for new session creation.

Rules:

- title is positional and required
- `--id` is optional
- `--compaction` is optional
- default compaction is `strip-reasoning`
- the CLI does not accept model or MCP identifiers in v3

### `mcpscope send <session-id> <prompt>`

Start one user turn for an existing session.

Rules:

- accepts prompt text as a positional argument
- if no prompt argument is given and stdin is piped, reads the prompt from stdin
- if neither is present, usage error
- no queueing: if the session is not ready, reject immediately

### `mcpscope status <session-id>`

Return a pollable session-centric lifecycle view.

## Lifecycle model for `status`

The CLI should expose a simplified lifecycle state derived from backend state:

- `initializing`
- `ready`
- `running`
- `error`

Requirements:

- `initializing` covers session setup/prelude still in progress
- `ready` means the session can accept a prompt
- `running` means a turn is currently in progress
- `error` means the session is in a failed state relevant to automation

When relevant, `status` should also expose:

- active turn ID
- a short turn summary
- a concise failure note when in error

## Command contracts

### `mcpscope list`

**Success text output**

- compact human-readable table
- same information level as the shipped session listing command

**Success JSON output**

```json
{
  "api_version": 1,
  "sessions": [
    {
      "id": "ABCD",
      "title": "My session",
      "status": "ready",
      "init_status": "ready",
      "model": "Qwen 3",
      "updated_at": 1747517400000
    }
  ]
}
```

### `mcpscope create <title> [--id <session-id>] [--compaction <strategy>]`

**Behavior**

- returns as soon as the session record exists
- may return while initialization is still `pending` or `initializing`
- returns enough session summary information to continue
- relies on backend defaults instead of CLI-side config selection

**Success text output**

- print the new session ID first
- print top-level session summary fields only
- do not print setup or turns

**Success JSON output**

```json
{
  "api_version": 1,
  "session": {
    "id": "ABCD",
    "title": "My session",
    "status": "ready",
    "init_status": "initializing",
    "model": {
      "id": "model-local-qwen",
      "name": "Local Qwen"
    },
    "mcp": {
      "id": "ha-local",
      "name": "Home Assistant"
    },
    "compaction_strategy": "strip-reasoning",
    "created_at": 1747517400000,
    "updated_at": 1747517400000
  }
}
```

**Important error cases**

- duplicate session ID
- invalid session ID
- no default model configured
- stale or invalid backend defaults

**Example JSON error**

```json
{
  "api_version": 1,
  "error": {
    "code": "default_model_not_configured",
    "command": "create",
    "message": "No default model config is configured for new sessions.",
    "retryable": false,
    "suggestion": "Set a default model config in the UI before creating a session from the CLI."
  }
}
```

### `mcpscope send <session-id> <prompt>`

**Success text output**

- print the session ID and started turn ID
- indicate that polling should continue via `mcpscope status <session-id>`

**Success JSON output**

```json
{
  "api_version": 1,
  "session_id": "ABCD",
  "turn": {
    "id": "ABCD.1",
    "status": "running"
  }
}
```

**Error behavior**

- reject immediately if the session is not ready
- explicitly state that nothing was queued

### `mcpscope status <session-id>`

**Success text output**

- always show session ID and lifecycle state first
- when `running`, include the active turn ID and short summary
- when `error`, include a concise failure note if available

**Success JSON output**

```json
{
  "api_version": 1,
  "session": {
    "id": "ABCD",
    "state": "running"
  },
  "active_turn": {
    "id": "ABCD.1",
    "status": "streaming"
  }
}
```

## Required backend support

### 1. Defaults-based session creation contract

Add or refine a session-creation path that:

- accepts CLI-friendly input:
  - `title`
  - optional `sessionId`
  - optional `compactionStrategy`
- resolves backend-owned defaults
- builds frozen snapshots internally
- returns immediately after the session record exists

### 2. Detached prompt execution

Add a backend path that lets the CLI submit a prompt without holding open an SSE connection.

Requirements:

- return enough information to poll
- persist enough lifecycle state for later status checks
- reject when the session is not ready

### 3. Pollable session status

Add a backend session status view that tells the CLI whether the session is:

- initializing
- ready
- running
- error

and includes the active turn ID when relevant.

## Implementation plan

### 1. Finalize the contract

- settle exact command names and aliases
- define text and JSON outputs
- define lifecycle state mapping
- define machine-readable error codes for create/send/status

### 2. Implement backend support

- add defaults-based create path
- add detached prompt execution support
- add pollable session status support

### 3. Implement CLI commands

- keep session listing compatible
- add `create`
- add `send`
- add `status`
- keep help text and examples aligned

### 4. Final consistency pass

- update `CLI.md` and related docs to match shipped behavior
- confirm no stale references remain to old create-session assumptions
- keep the repo green
