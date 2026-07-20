# mcpscope CLI

In-repo command surface for driving and inspecting sessions. Talks to the backend API only and uses the same backend-owned session model and canonical IDs as the UI.

## Running from Docker

To run the CLI inside the container: `docker exec -i mcpscope-app mcpscope <cmd>` (or define the `mcpscope()` shell helper) — see [TUTORIAL.md](TUTORIAL.md).

Inside the container, `mcpscope` defaults to `http://127.0.0.1:3066`.

## Connection

```sh
mcpscope --url http://host:3066 <command>    # explicit
MCPSCOPE_URL=http://host:3066 mcpscope …    # env var
mcpscope …                                  # default: http://localhost:3066
```

## Commands

### `mcpscope list [--limit <n>] [--offset <n>] [--json]`

Lists top-level sessions — standalone primary sessions only, most recently updated first.
Benchmark-run and judge/analysis sessions are intentionally excluded; reach them through
their benchmark/run (`benchmark_inspect`, `benchmark_run_report`) or parent session. Alias
for `sessions list`.  
Text output is a columnar table (ID, title, status, model, updated) followed by a
`Showing X-Y of N` line. Paginated with `--limit` (default 50, max 200) and `--offset`.  
`--json` → `{ api_version: 1, sessions: [{ id, title, status, model, updated_at }], total, limit, offset, has_more }`.
Rows are deliberately compact; richer per-session detail comes from `inspect`.

### `mcpscope create [title] [--id <session-id>] [--compaction <strategy>] [--model-config <id>] [--mcp-profile <id>...] [--max-tool-rounds <n>] [--wait] [--json]`

Creates a session using backend-owned defaults (set via the UI) or explicit model/MCP selection.

- `[title]` — session title (optional, positional). When omitted, the session starts as `New session` and is auto-titled from the first prompt.
- `--id <session-id>` — optional 4-char explicit session ID (A-Z 2-9, no O/I/0/1)
- `--compaction <strategy>` — `strip-reasoning` (default) or `none`
- `--model-config <id>` — optional model config ID; uses the configured default if omitted
- `--mcp-profile <id>` — repeatable; passing it one or more times selects specific MCP profiles instead of the default-enabled set
- `--max-tool-rounds <n>` — cap on tool rounds per turn (default: 20)
- `--wait` — block until initialization finishes; the returned `init_status` is terminal (`ready` or `error`) and the session can take a prompt immediately

When `--model-config` and `--mcp-profile` are omitted, the backend resolves the default model config, its LM connection, and any MCP server profiles with `defaultEnabled` set, then builds snapshots and starts initialization in the background.  
Returns as soon as the session record exists — initialization may still be in progress (use `--wait` to block until it finishes and skip the status polling).

**Text output** — prints session ID and summary, then suggests the next step.  
**JSON output** — `{ api_version: 1, session: { id, title, status, init_status, model: { id, name }, mcp: [{ id, name }], compaction_strategy, max_tool_rounds, created_at, updated_at } }`.

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
| `another_session_active` | another session is already active/running; finish or stop the active session first |

### `mcpscope send <session-id> <prompt> [--wait] [--json]`

Starts one user turn for an existing session by enqueueing execution (non-streaming).

- `<session-id>` — positional
- `<prompt>` — positional; if absent and stdin is piped, reads from stdin; otherwise usage error
- `--wait` — block until the turn reaches a terminal state; `turn.status` is then `complete`/`error`/`aborted` and the turn can be inspected immediately

The session must be fully initialized (`status` = `ready`) before sending. Without `--wait` the request enqueues work and returns immediately (poll with `mcpscope status` to track progress); with `--wait` there is no polling loop — the command returns when the turn is done.

**Text output** — prints session ID, turn ID, and polling hint.  
**JSON output** — `{ api_version: 1, session_id, turn: { id, status: "running" } }`.

**Error codes in JSON**:
| code | meaning |
|------|---------|
| `session_not_found` | session ID does not exist |
| `session_not_initialized` | session has not finished initialization yet |
| `turn_in_progress` | another turn is already active for the session |
| `another_session_active` | another session is already active/running; finish or stop the active session first |

### `mcpscope status <session-id> [--json]`

Returns the current lifecycle state of a session.

**Lifecycle states**:
| state | meaning |
|-------|---------|
| `initializing` | session setup / prelude still in progress |
| `ready` | session can accept a prompt |
| `running` | a turn is currently executing |
| `error` | session is in a failed state |

**Text output** — always shows session ID and state; when `running`, also shows the active turn ID; when the session's turn is still queued behind other work, shows its 1-based queue position; when `ready`, suggests the next `send` command.  
**JSON output** — `{ api_version: 1, session: { id, state }, active_turn: { id, status } | null }`.
When the session has a pending job that has not started executing yet, adds `queue_position`
(1-based position in the scheduler queue).
Analysis sessions may add `workflow_kind` and `latest_error`.

**Error codes in JSON**:
| code | meaning |
|------|---------|
| `session_not_found` | session ID does not exist |

### `mcpscope inspect <id> [--short] [--json]`

Inspects any object by ID. Calls `GET /api/lookup/:id` — the same operation the UI's id-pill and the MCP `mcpscope_inspect` tool use, so every surface returns identical payloads.

| ID format       | Type    | Example        |
|-----------------|---------|----------------|
| `SSS`           | session | `QGWA`         |
| `SSS.S`         | setup   | `QGWA.S`       |
| `SSS.NW`        | step (workflow) | `QGWA.4W` |
| `SSS.NC`        | step (compaction) | `QGWA.2C` |
| `SSS.NT`        | turn    | `QGWA.1T`      |
| `SSS.W.NT`      | turn    | `QGWA.4W.1T`   |
| `SSS.NT.N`      | round   | `QGWA.1T.2`    |
| `SSS.W.NT.N`    | round   | `QGWA.4W.1T.2` |
| `SSS.NT.N.N-X`  | part    | `QGWA.1T.2.3-U` |
| `SSS.W.NT.N.N-X`| part    | `QGWA.4W.1T.2.3-R` |
| `B-XXXX`        | benchmark  | `B-84JK`    |
| `B-XXXX.N`      | case       | `B-84JK.1`  |
| `R-XXXX`        | run (full mode adds the metrics report) | `R-C5PV` |
| `E-XXXX`        | evaluation (with scores) | `E-HGTU` |

`--short` omits part content (token counts only). Parts always return full content regardless of `--short`.

`tool_definitions` parts always show tool names; inspect the part ID directly for full schemas.

**Text output** — parts rendered ID-first, turns separated by blank lines:

```text
QGWA.S.1-SP  system_prompt  (167 tokens)
QGWA.S.2-MI  mcp_instructions  (371 tokens)
QGWA.S.3-TD  tool_definitions  (1043 tokens)
  geocode_place, get_current_weather, get_forecast, get_historical_weather

QGWA.1T.1.1-U  user_prompt  (33 tokens)
  What's the current temperature in Paris?

QGWA.1T.1.2-A  assistant_answer  (112 tokens)
  The current temperature in Paris is 14°C.

QGWA.1T.1.3-T  tool_call  get_current_weather  (824 tokens)
```

The text rendering comes from the backend (the same renderer serves every surface); the CLI
prints it verbatim. Stripped parts: `(N tokens - stripped)`.

**JSON output** passes through the raw lookup response: `{ id, type, mode, data }`.

### `mcpscope list_model_configs [--json]`

Lists all model configs with their ID, name, connection, model key, and provider type.

```text
$ mcpscope list_model_configs
mc-qwen      Qwen 2.5 7B      LM Studio     qwen2.5-7b-instruct   lmstudio
mc-sonnet    Claude Sonnet    OpenRouter    anthropic/claude-sonnet-4   openrouter
```

`--json` returns the full list: `{ model_configs: [...] }`.

### `mcpscope list_mcp_profiles [--json]`

Lists all MCP server profiles with their ID, name, URL, and status tags. `[built-in]` marks a
bundled [companion server](COMPANIONS.md) (read-only); `[default]` marks a session default. A
key-gated companion whose API key is not configured is listed with an `unavailable:` line naming
the config key to set (and cannot be used to create a session until then).

```text
$ mcpscope list_mcp_profiles
home-assistant       Home Assistant                 http://host:8123/mcp   [default]
builtin-open-meteo   Open-Meteo Weather (built-in)  http://localhost:3066/companions/open-meteo/mcp   [built-in]
builtin-guardian     The Guardian News (built-in)   http://localhost:3066/companions/guardian/mcp   [built-in]
    unavailable: Set companions.guardian.api_key in the mcpscope config file to enable this server.
```

`--json` returns the full list: `{ mcp_profiles: [...] }`, each entry with `id`, `name`, `url`,
`default_enabled`, `source` (`"builtin"` | `"user"`), and `disabled_reason` (`null` or the config
requirement).

### `mcpscope delete_session <session-id> [--json]`

Deletes a session and all its child sessions, turns, rounds, parts, and raw exchanges.
Rejects if the session has an active or queued job — abort it first (`abort_session`).

**Text output** — `Deleted session <id>`.  
**JSON output** — `{ api_version: 1, deleted: true, session_id }`.

**Error codes in JSON**:
| code | meaning |
|------|---------|
| `session_not_found` | session ID does not exist |
| `session_already_queued` | the session has an active or queued job |

### `mcpscope rename_session <session-id> <title> [--json]`

Renames a session (updates its title). The title is trimmed; 1-200 characters.

**Text output** — `Renamed session <id> to "<title>"`.  
**JSON output** — `{ api_version: 1, session_id, title }`.

**Error codes in JSON**:
| code | meaning |
|------|---------|
| `session_not_found` | session ID does not exist |
| `invalid_title` | title is empty after trimming |

### `mcpscope abort_session <session-id> [--json]`

Aborts the session's active turn (signalling the in-flight model request) or dequeues its
pending job. Unlike the scheduler-wide abort, this only touches the given session.

**Text output** — states which of the three outcomes happened.  
**JSON output** — `{ api_version: 1, session_id, outcome }` with `outcome` one of
`aborted` (active turn signalled), `dequeued` (pending job removed before it started), or
`not-running` (no job matched the session).

**Error codes in JSON**:
| code | meaning |
|------|---------|
| `session_not_found` | session ID does not exist |
| `scheduler_unavailable` | no execution scheduler is available |

## Benchmark commands

These commands drive the benchmark feature (see [BENCHMARK.md](BENCHMARK.md)). They are flat, catalog-backed commands — each is also exposed as an `mcpscope_<id>` MCP tool (CLI/MCP parity) — and return **snake_case** results. All support `--json` and `--url`. Input is validated against the operation's schema on every surface; malformed input fails with a structured `benchmark_invalid_input` error (HTTP 400, CLI exit code 1) instead of being persisted.

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

### `mcpscope benchmark_update_case <case_id> [--name <text>] [--prompt <text>] [--order <n>] [--expect-tool <name>]... [--forbid-tool <name>]... [--rubric-json <json>] [--json]`

Edits an existing case; only the fields you pass change. `--expect-tool` / `--forbid-tool` (repeatable) **replace** the respective check; `--rubric-json` takes a JSON array of `{ id, description, points }` (`id` and `points` are integers) and replaces the rubric. JSON output: same `{ case }` shape as `benchmark_add_case`. (The MCP tool takes the rubric as a structured `rubric` array directly.)

### `mcpscope benchmark_delete_case <case_id> [--json]`

Deletes a case from its benchmark (past runs keep their own snapshot). JSON output: `{ case_id, deleted }`.

### `mcpscope benchmark_delete <benchmark_id> [--json]`

Deletes a benchmark blueprint and its cases. Past runs are independent snapshots and are **kept**. JSON output: `{ benchmark_id, deleted }`.

### `mcpscope benchmark_run <benchmark_id> [--case <id>]... [--repetitions <n>] [--model-config <id>] [--mcp-profile <id>]... [--max-tool-rounds <n>] [--wait] [--json]`

Launches a benchmark run in the background and returns the run immediately (`status: "pending"`).

- `<benchmark_id>` — positional
- `--case <id>` — repeatable; subset of case ids to run (default: all cases)
- `--repetitions <n>` — positive integer; times to run each case (default: 1)
- `--model-config <id>` — model config to use (default: the configured default)
- `--mcp-profile <id>` — repeatable; MCP profiles to enable (default: the configured defaults)
- `--max-tool-rounds <n>` — cap on tool rounds per turn for the run's sessions (default: 20)
- `--wait` — poll `benchmark_run_status` until the run reaches a terminal state, then print final progress

Without `--wait`, text output prints the run ID and status plus hints to poll status or fetch the report. JSON output: `{ run: {...} }`. With `--wait`, output is the final run-status object (the progress shape below).

### `mcpscope benchmark_run_status <run_id> [--json]`

Returns cheap, pollable **progress** for a run (derived from the run record only — no session traces loaded), distinct from the heavier `benchmark_run_report`. The coordinator records each session at creation with a `running`/`complete`/`error` status, so progress reflects in-flight work.

Text output shows overall and per-case completion, the currently running session, and terminal status. JSON output: `{ run_id, benchmark_id, benchmark_name, status, repetitions, total_cases, total_sessions, completed_sessions, failed_sessions, per_case: [{ source_case_id, name, completed, total }], current_session_id, error, started_at, completed_at }`.

### `mcpscope benchmark_run_report <run_id> [--json]`

Returns the full compute-on-read **metrics** report for a run (loads session traces): per-case pass rates, tool-call/token stats, per-session metrics, and a cross-case per-tool rollup. Text output leads with the per-tool rollup, then per-case detail. JSON output: `{ run, report }`. For what the metrics mean (pass@k vs pass^k, the per-tool scorecard, what the checks evaluate), see [BENCHMARK.md → Report and metrics](BENCHMARK.md#report-and-metrics).

### `mcpscope benchmark_run_control <run_id> --action <pause|resume|stop> [--mode <continue|retry>] [--json]`

Pauses, resumes, or stops a benchmark run. `--action` is required. `stop` leaves the run at `stopped` (resumable, partial results kept); `resume` re-enqueues its remaining work — `--mode continue` (default) picks up never-run sessions, `--mode retry` also re-runs cancelled/errored ones (`--mode` applies to `resume` only). Text output: `{run_id}  {status}`. JSON output: `{ run }`.

### `mcpscope benchmark_delete_run <run_id> [--json]`

Deletes a run snapshot: its report, its produced sessions, and its evaluation passes (judge sessions included). The benchmark blueprint is untouched. An active (pending/running/paused) run is refused with `benchmark_run_active` — stop it first via `benchmark_run_control`. JSON output: `{ run_id, deleted }`.

### `mcpscope benchmark_evaluate <run_id> --judge-model <model_config_id> [--temperature <n>] [--json]`

Launches an **LLM evaluation** pass over a completed run: a separate judge model scores each session against its case rubric. **Only sessions whose case has a rubric are judged** — the rest are skipped and reported as a `skipped_no_rubric` count (the pass still completes). A run whose snapshot has no rubric'd case at all is refused with `benchmark_no_rubric`. `--temperature` sets the judge sampling temperature. On the CLI, **omitting `--temperature` sends `null`** — the judge runs with no temperature param, i.e. the provider's own default. Note this differs from the MCP/HTTP path, which defaults to `0.2` when `temperature` is omitted (rationale for the low-temperature default: [BENCHMARK.md](BENCHMARK.md)). Returns immediately (`{ evaluation: { id, status, judge_temperature, ... } }`); the pass runs in the background. Repeatable — run it again with a different `--judge-model`/`--temperature` to compare. See [BENCHMARK.md → Evaluation](BENCHMARK.md#evaluation-llm-rubric-judging). Rubrics are authored via the UI, via `--rubric-json` on `benchmark_update_case` (CLI), or via the `rubric` field on `benchmark_add_case`/`benchmark_update_case` (MCP/HTTP). Note the CLI asymmetry: `benchmark_add_case` has no rubric flag — add the case, then set the rubric with `benchmark_update_case`. Rubrics are snapshotted into runs at launch, so author them **before** the run you want judged.

### `mcpscope benchmark_run_evaluations <run_id> [--json]`

Lists a run's evaluation passes with scores computed on read from the judge verdicts. Text output shows, per pass, the judge model, status, overall %, and a per-case min/mean/max line. JSON output: `{ evaluations: [{ id, run_id, judge_model_config_id, status, sessions, score: { overall_pct, cases: [{ source_case_id, name, pct_stats, sessions: [{ analysis_session_id, awarded, max, pct, ... }] }] } }] }`. Open an `analysis_session_id` (e.g. with `mcpscope inspect`) to read the judge's verdict and reasoning.

### `mcpscope benchmark_evaluation_control <evaluation_id> --action <pause|resume|stop> [--mode <continue|retry>] [--json]`

Pauses, resumes, or stops an LLM evaluation pass. Mirrors `benchmark_run_control` for evaluations (the judging passes over a completed run). `--action` is required; `stop` aborts the in-flight judge and leaves the pass at `stopped` (resumable, scored sessions kept); `resume` re-judges the remaining sessions — `--mode continue` (default) judges never-judged sessions, `--mode retry` also re-judges cancelled/errored ones. Text output: `{evaluation_id}  {status}`. JSON output: `{ evaluation }`.

### `mcpscope benchmark_delete_evaluation <evaluation_id> [--json]`

Deletes one evaluation pass and the judge sessions it spawned. The run and its sessions are kept. An active pass is refused with `benchmark_evaluation_active` — stop it first. JSON output: `{ evaluation_id, deleted }`.

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
| `--max-tool-rounds <n>` | `create`, `benchmark_run` | cap on tool rounds per turn (default: 20) |
| `--description <text>` | `benchmark_create` | optional benchmark description |
| `--name <text>`    | `benchmark_add_case`, `benchmark_add_case_from_session`, `benchmark_update_case` | optional case label |
| `--prompt <text>`  | `benchmark_update_case` | new prompt text |
| `--order <n>`      | `benchmark_update_case` | new position within the suite |
| `--expect-tool <name>` | `benchmark_add_case`, `benchmark_update_case` | repeatable; tool that should be called |
| `--forbid-tool <name>` | `benchmark_add_case`, `benchmark_update_case` | repeatable; tool that should NOT be called |
| `--rubric-json <json>` | `benchmark_update_case` | JSON array of `{id, description, points}` (integer `id`/`points`) to replace the rubric |
| `--case <id>`      | `benchmark_run`    | repeatable; subset of case ids to run |
| `--repetitions <n>` | `benchmark_run`   | times to run each case (default: 1) |
| `--wait`           | `create`, `send`, `benchmark_run` | block until terminal: init finished / turn complete / run finished (`create`/`send` hold one request open; `benchmark_run` polls run status internally) |
| `--judge-model <id>` | `benchmark_evaluate` | model config ID for the judge (required) |
| `--temperature <n>` | `benchmark_evaluate` | judge sampling temperature; omit to send `null` (provider default). The MCP/HTTP path instead defaults to `0.2` when omitted. |

## Exit codes

| Code | Meaning          |
|------|------------------|
| 0    | success          |
| 1    | runtime error    |
| 2    | usage / bad args |

On a runtime error, plain-text mode prints `error: <message>` to stderr. With `--json`, the error
is emitted as machine-readable JSON on stdout — the same envelope the backend uses, carrying the
codes from the per-command tables above:

```json
{ "error": { "message": "…", "code": "another_session_active", "active_session": { "id": "ABCD", "state": "running" } } }
```
