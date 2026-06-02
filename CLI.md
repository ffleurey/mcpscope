# mcpscope CLI

In-repo command surface for driving and inspecting sessions. Talks to the backend API only and uses the same backend-owned session model and canonical IDs as the UI.

## Running from Docker

The packaged MVP path is to run the CLI **inside the mcpscope container**:

```bash
docker exec -i mcpscope-app mcpscope list
docker exec -i mcpscope-app mcpscope create "test session"
docker exec -i mcpscope-app mcpscope send ABCD "hello"
```

Inside the container, `mcpscope` defaults to `http://127.0.0.1:3030`.

If you want a shorter host command, define an alias or shell function:

```bash
mcpscope() {
  docker exec -i mcpscope-app mcpscope "$@"
}
```

## Connection

```
mcpscope --url http://host:3030 <command>    # explicit
MCPSCOPE_URL=http://host:3030 mcpscope …    # env var
mcpscope …                                  # default: http://localhost:3030
```

## Commands

### `mcpscope list [--json]`

Lists all sessions. Alias for `sessions list`.  
Text output is a columnar table (ID, title, status, model, updated).  
`--json` → `{ api_version: 1, sessions: [...] }`.

### `mcpscope create <title> [--id <session-id>] [--compaction <strategy>] [--json]`

Creates a session using backend-owned defaults (set via the UI).

- `<title>` — session title (required, positional)
- `--id <session-id>` — optional 4-char explicit session ID (A-Z 2-9, no O/I/0/1)
- `--compaction <strategy>` — `strip-reasoning` (default) or `none`

The backend resolves the default model config, its LM connection, and optionally the default MCP profile, then builds snapshots and starts initialization in the background.  
Returns as soon as the session record exists — initialization may still be in progress.

**Text output** — prints session ID and summary, then suggests the next step.  
**JSON output** — `{ api_version: 1, session: { id, title, status, init_status, model: { id, name }, mcp: { id, name } | null, compaction_strategy, created_at, updated_at } }`.

**Error codes in JSON**:
| code | meaning |
|------|---------|
| `default_model_not_configured` | no default model has been set in the UI |
| `default_model_config_not_found` | default model config was deleted after the default was set |
| `default_lm_connection_not_found` | LM connection referenced by the default model config was deleted |
| `default_mcp_profile_not_found` | default MCP profile was deleted after the default was set |
| `invalid_session_id` | `--id` value is not a valid session ID format |
| `duplicate_session_id` | `--id` value is already in use |

### `mcpscope send <session-id> <prompt> [--json]`

Starts one user turn for an existing session by enqueueing execution (non-streaming, returns immediately).

- `<session-id>` — positional
- `<prompt>` — positional; if absent and stdin is piped, reads from stdin; otherwise usage error

The session must be fully initialized (`status` = `ready`) before sending. The request enqueues work for that session and returns immediately; the scheduler may run it right away or after earlier queued work. Poll with `mcpscope status` to track progress.

**Text output** — prints session ID, turn ID, and polling hint.  
**JSON output** — `{ api_version: 1, session_id, turn: { id, status: "running" }, job: { jobId, status: "queued" } }`.

**Error codes in JSON**:
| code | meaning |
|------|---------|
| `session_not_found` | session ID does not exist |
| `session_not_initialized` | session has not finished initialization yet |
| `turn_in_progress` | another turn is already active for the session |

### `mcpscope status <session-id> [--json]`

Returns the current lifecycle state of a session.

**Lifecycle states**:
| state | meaning |
|-------|---------|
| `initializing` | session setup / prelude still in progress |
| `ready` | session can accept a prompt |
| `running` | a turn is currently executing |
| `error` | session is in a failed state |

**Text output** — always shows session ID and state; when `running`, also shows the active turn ID; when `ready`, suggests the next `send` command.  
**JSON output** — `{ api_version: 1, session: { id, state }, active_turn: { id, status } | null }`.

**Error codes in JSON**:
| code | meaning |
|------|---------|
| `session_not_found` | session ID does not exist |

### `mcpscope inspect <id> [--short] [--json]`

Inspects any object by hierarchical ID. Calls `GET /api/lookup/:id`.

| ID format       | Type    | Example        |
|-----------------|---------|----------------|
| `SSS`           | session | `QGWA`         |
| `SSS.S`         | setup   | `QGWA.S`       |
| `SSS.N`         | turn    | `QGWA.1`       |
| `SSS.N.N`       | round   | `QGWA.1.2`     |
| `SSS.N.N.N-X`  | part    | `QGWA.1.2.3-U` |

`--short` omits part content (token counts only). Parts always return full content regardless of `--short`.

`tool_definitions` parts always show tool names; inspect the part ID directly for full schemas.

**Text output** — parts rendered ID-first, turns separated by blank lines:

```
QGWA.S.1-SP  system_prompt  (167 tokens)
QGWA.S.2-MI  mcp_instructions  (371 tokens)
QGWA.S.3-TD  tool_definitions  (4169 tokens)
  ha_history_list_entities, ha_history_get, ha_forecast_get

QGWA.1.1.1-U  user_prompt  (33 tokens)
  Hello! what is the current temp outside?

QGWA.1.1.2-A  assistant_answer  (112 tokens)
  The current outdoor temperature is 14°C.

QGWA.1.1.3-T  tool_call  ha_history_list_entities  (824 tokens)
```

Token counts are dimmed on TTY. `user_prompt` / `assistant_answer` content is bold.  
Stripped parts: `(N tokens - stripped)`.

**JSON output** passes through the raw lookup response: `{ id, type, mode, data }`.

### `mcpscope sessions list [--json]`

Legacy form of `list`. Kept for backward compatibility.

## Typical automation loop

```sh
# 1. Create a session (backend resolves model/MCP from defaults)
mcpscope create "My test session"
# → prints session ID, e.g. ABCD

# 2. Wait until the session is ready
mcpscope status ABCD   # repeat until state = ready

# 3. Send a prompt
mcpscope send ABCD "What is the current temperature outside?"
# → prints turn ID, e.g. ABCD.1

# 4. Poll until the turn is done
mcpscope status ABCD   # repeat until state = ready (or error)

# 5. Inspect the result
mcpscope inspect ABCD.1
```

## Flags

| Flag          | Applies to  | Effect                              |
|---------------|-------------|-------------------------------------|
| `--json`      | all         | emit JSON instead of text           |
| `--short`     | `inspect`   | token counts only, no content       |
| `--url <url>` | all         | backend URL (overrides MCPSCOPE_URL)|

## Exit codes

| Code | Meaning          |
|------|------------------|
| 0    | success          |
| 1    | runtime error    |
| 2    | usage / bad args |
