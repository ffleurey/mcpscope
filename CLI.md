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

### `mcpscope create <title> [--id <session-id>] [--compaction <strategy>] [--model-config <id>] [--mcp-profile <id>...] [--json]`

Creates a session using backend-owned defaults (set via the UI) or explicit model/MCP selection.

- `<title>` — session title (required, positional)
- `--id <session-id>` — optional 4-char explicit session ID (A-Z 2-9, no O/I/0/1)
- `--compaction <strategy>` — `strip-reasoning` (default) or `none`
- `--model-config <id>` — optional model config ID; uses the configured default if omitted
- `--mcp-profile <id>` — repeatable; zero or one selects specific MCP profiles instead of the default-enabled set

When `--model-config` and `--mcp-profile` are omitted, the backend resolves the default model config, its LM connection, and any MCP server profiles with `defaultEnabled` set, then builds snapshots and starts initialization in the background.  
Returns as soon as the session record exists — initialization may still be in progress.

**Text output** — prints session ID and summary, then suggests the next step.  
**JSON output** — `{ api_version: 1, session: { id, title, status, init_status, model: { id, name }, mcp: [{ id, name }], compaction_strategy, created_at, updated_at } }`.

**Error codes in JSON**:
| code | meaning |
|------|---------|
| `default_model_not_configured` | no default model has been set in the UI |
| `model_config_not_found` | `--model-config` value does not match any existing model config |
| `lm_connection_not_found` | the selected model config references an LM connection that no longer exists |
| `mcp_profile_not_found` | one or more `--mcp-profile` values do not match any existing MCP profile |
| `default_lm_connection_not_found` | LM connection referenced by the default model config was deleted |
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
| `SSS.W`         | step    | `QGWA.4W`      |
| `SSS.NT`        | turn    | `QGWA.1T`      |
| `SSS.W.NT`      | turn    | `QGWA.4W.1T`   |
| `SSS.NT.N`      | round   | `QGWA.1T.2`    |
| `SSS.W.NT.N`    | round   | `QGWA.4W.1T.2` |
| `SSS.NT.N.N-X`  | part    | `QGWA.1T.2.3-U` |
| `SSS.W.NT.N.N-X`| part    | `QGWA.4W.1T.2.3-R` |

`--short` omits part content (token counts only). Parts always return full content regardless of `--short`.

`tool_definitions` parts always show tool names; inspect the part ID directly for full schemas.

**Text output** — parts rendered ID-first, turns separated by blank lines:

```
QGWA.S.1-SP  system_prompt  (167 tokens)
QGWA.S.2-MI  mcp_instructions  (371 tokens)
QGWA.S.3-TD  tool_definitions  (4169 tokens)
  ha_history_list_entities, ha_history_get, ha_forecast_get

QGWA.1T.1.1-U  user_prompt  (33 tokens)
  Hello! what is the current temp outside?

QGWA.1T.1.2-A  assistant_answer  (112 tokens)
  The current outdoor temperature is 14°C.

QGWA.1T.1.3-T  tool_call  ha_history_list_entities  (824 tokens)
```

Token counts are dimmed on TTY. `user_prompt` / `assistant_answer` content is bold.  
Stripped parts: `(N tokens - stripped)`.

**JSON output** passes through the raw lookup response: `{ id, type, mode, data }`.

### `mcpscope list_model_configs [--json]`

Lists all model configs with their ID, name, connection, model key, and provider type.

```
$ mcpscope list_model_configs
home-assistant   Home Assistant    http://host:8123/mcp   enabled
weather-mcp      Weather MCP       http://host:8000/mcp   disabled
```

`--json` returns the full list: `{ model_configs: [...] }`.

### `mcpscope list_mcp_profiles [--json]`

Lists all MCP server profiles with their ID, name, URL, and default-enabled status.

```
$ mcpscope list_mcp_profiles
home-assistant   Home Assistant    http://host:8123/mcp   enabled
weather-mcp      Weather MCP       http://host:8000/mcp   disabled
```

`--json` returns the full list: `{ mcp_profiles: [...] }`.

## Benchmark commands

These commands drive the benchmark feature (see [BENCHMARK.md](BENCHMARK.md)). They are flat, catalog-backed commands — each is also exposed as an `mcpscope_<id>` MCP tool (CLI/MCP parity) — and return **snake_case** results. All support `--json` and `--url`.

### `mcpscope benchmark_create <name> [--description <text>] [--json]`

Creates a new empty benchmark blueprint.

- `<name>` — benchmark name (required, positional)
- `--description <text>` — optional description

Text output prints the benchmark ID and name. JSON output: `{ benchmark: { id, name, description, created_at, updated_at } }`.

### `mcpscope benchmark_list [--json]`

Lists all benchmarks as a columnar table (ID, name, cases, runs). JSON output: `{ benchmarks: [{ id, name, description, case_count, run_count, created_at, updated_at }] }`.

### `mcpscope benchmark_inspect <benchmark_id> [--json]`

Inspects a benchmark: prints the benchmark, its cases, and its runs. JSON output: `{ benchmark, cases: [...], runs: [...] }`.

### `mcpscope benchmark_add_case <benchmark_id> <prompt> [--name <text>] [--expect-tool <name>]... [--forbid-tool <name>]... [--json]`

Adds a case (a prompt plus optional tool-behavior expectations) to a benchmark.

- `<benchmark_id>` — positional
- `<prompt>` — positional, the user prompt the case sends
- `--name <text>` — optional human label
- `--expect-tool <name>` — repeatable; a tool that should be called (`expected_tools_called`)
- `--forbid-tool <name>` — repeatable; a tool that should NOT be called (`expected_tools_not_called`)

JSON output: `{ case: { id, benchmark_id, name, prompt, order_index, expected_tools_called, expected_tools_not_called, source_session_id, created_at, updated_at } }`.

### `mcpscope benchmark_add_case_from_session <benchmark_id> <session_id> [--name <text>] [--json]`

Creates a case from an existing session: uses its first user message as the prompt and pre-fills `expected_tools_called` with the tools that session actually called (editable defaults).

- `<benchmark_id>` — positional
- `<session_id>` — positional, the session to extract from
- `--name <text>` — optional human label

JSON output: same `{ case }` shape as `benchmark_add_case`.

### `mcpscope benchmark_run <benchmark_id> [--case <id>]... [--repetitions <n>] [--model-config <id>] [--mcp-profile <id>]... [--wait] [--json]`

Launches a benchmark run in the background and returns the run immediately (`status: "pending"`).

- `<benchmark_id>` — positional
- `--case <id>` — repeatable; subset of case ids to run (default: all cases)
- `--repetitions <n>` — positive integer; times to run each case (default: 1)
- `--model-config <id>` — model config to use (default: the configured default)
- `--mcp-profile <id>` — repeatable; MCP profiles to enable (default: the configured defaults)
- `--wait` — poll `benchmark_run_status` until the run reaches a terminal state, then print final progress

Without `--wait`, text output prints the run ID and status plus hints to poll status or fetch the report. JSON output: `{ run: {...} }`. With `--wait`, output is the final run-status object (the progress shape below).

### `mcpscope benchmark_run_status <run_id> [--json]`

Returns cheap, pollable **progress** for a run (derived from the run record only — no session traces loaded), distinct from the heavier `benchmark_run_report`. The coordinator records each session at creation with a `running`/`complete`/`error` status, so progress reflects in-flight work.

Text output shows overall and per-case completion, the currently running session, and terminal status. JSON output: `{ run_id, benchmark_id, benchmark_name, status, repetitions, total_cases, total_sessions, completed_sessions, failed_sessions, per_case: [{ source_case_id, name, completed, total }], current_session_id, error, started_at, completed_at }`.

### `mcpscope benchmark_run_report <run_id> [--json]`

Returns the full compute-on-read **metrics** report for a run (loads session traces): per-case pass rates, tool-call/token stats, per-session metrics, and a cross-case per-tool rollup. Text output leads with the per-tool rollup, then per-case detail. JSON output: `{ run, report }`.

### `mcpscope sessions list [--json]`

Legacy form of `list`. Kept for backward compatibility.

## Typical automation loop

```sh
# 1. Create a session (backend resolves model from defaults, MCP from default-enabled profiles)
mcpscope create "My test session"
# → prints session ID, e.g. ABCD

# 2. Wait until the session is ready
mcpscope status ABCD   # repeat until state = ready

# 3. Send a prompt
mcpscope send ABCD "What is the current temperature outside?"
# → prints turn ID, e.g. ABCD.1T

# 4. Poll until the turn is done
mcpscope status ABCD   # repeat until state = ready (or error)

# 5. Inspect the result
mcpscope inspect ABCD.1T
```

## Flags

| Flag               | Applies to         | Effect                              |
|--------------------|--------------------|-------------------------------------|
| `--json`           | all                | emit JSON instead of text           |
| `--short`          | `inspect`          | token counts only, no content       |
| `--url <url>`      | all                | backend URL (overrides MCPSCOPE_URL)|
| `--model-config <id>` | `create`, `benchmark_run` | model config ID (instead of default)|
| `--mcp-profile <id>` | `create`, `benchmark_run` | repeatable; MCP profile IDs (instead of default-enabled) |
| `--description <text>` | `benchmark_create` | optional benchmark description |
| `--name <text>`    | `benchmark_add_case`, `benchmark_add_case_from_session` | optional case label |
| `--expect-tool <name>` | `benchmark_add_case` | repeatable; tool that should be called |
| `--forbid-tool <name>` | `benchmark_add_case` | repeatable; tool that should NOT be called |
| `--case <id>`      | `benchmark_run`    | repeatable; subset of case ids to run |
| `--repetitions <n>` | `benchmark_run`   | times to run each case (default: 1) |
| `--wait`           | `benchmark_run`    | poll run status until terminal, then print final progress |

## Exit codes

| Code | Meaning          |
|------|------------------|
| 0    | success          |
| 1    | runtime error    |
| 2    | usage / bad args |
