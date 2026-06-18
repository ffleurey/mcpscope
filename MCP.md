# mcpscope MCP interface

mcpscope exposes an MCP tool surface via Streamable HTTP on the same Fastify server as the backend API.

## Transport

**Streamable HTTP** only. No stdio transport in this version.

| Method   | Path  | Purpose                                    |
|----------|-------|--------------------------------------------|
| `POST`   | `/mcp` | JSON-RPC tool calls (initialize, tools/call, etc.) |
| `GET`    | `/mcp` | SSE stream for server-initiated messages   |
| `DELETE` | `/mcp` | Session termination (stateless: no-op)     |

The transport operates in **stateless mode** — no server-side session is maintained between requests.

## Tool surface

Fifteen tools mirror the shipped CLI surface exactly — every operation in the backend catalog is both a `mcpscope <id>` CLI command and a `mcpscope_<id>` MCP tool (CLI/MCP parity). Tool names are generated mechanically from the backend-owned operation catalog using the `mcpscope_` prefix.

Seven session/config tools:

| MCP tool name               | CLI command                        | Description |
|-----------------------------|------------------------------------|-------------|
| `mcpscope_list`             | `mcpscope list`                    | List all sessions |
| `mcpscope_create`           | `mcpscope create`                  | Create a session from defaults or explicit model/MCP selection |
| `mcpscope_send`             | `mcpscope send`                    | Start a user turn |
| `mcpscope_status`           | `mcpscope status`                  | Get session lifecycle state |
| `mcpscope_inspect`          | `mcpscope inspect`                 | Inspect any object by hierarchical ID |
| `mcpscope_list_model_configs` | `mcpscope list_model_configs`    | List all model configs |
| `mcpscope_list_mcp_profiles`  | `mcpscope list_mcp_profiles`     | List all MCP server profiles |

Eight benchmark tools (the agent-facing benchmark surface — see [BENCHMARK.md](BENCHMARK.md)):

| MCP tool name                           | CLI command                                | Description |
|-----------------------------------------|--------------------------------------------|-------------|
| `mcpscope_benchmark_create`             | `mcpscope benchmark_create`                | Create a new empty benchmark blueprint |
| `mcpscope_benchmark_list`               | `mcpscope benchmark_list`                  | List all benchmarks with case and run counts |
| `mcpscope_benchmark_inspect`            | `mcpscope benchmark_inspect`               | Inspect a benchmark: its cases and runs |
| `mcpscope_benchmark_add_case`           | `mcpscope benchmark_add_case`              | Add a case (prompt + optional tool expectations) |
| `mcpscope_benchmark_add_case_from_session` | `mcpscope benchmark_add_case_from_session` | Add a case from an existing session's first prompt |
| `mcpscope_benchmark_run`                | `mcpscope benchmark_run`                   | Launch a run in the background; returns the run immediately |
| `mcpscope_benchmark_run_status`         | `mcpscope benchmark_run_status`            | Cheap, pollable run progress (no session traces loaded) |
| `mcpscope_benchmark_run_report`         | `mcpscope benchmark_run_report`            | Full compute-on-read metrics report (loads session traces) |

`mcpscope_benchmark_run_status` returns lightweight **progress** (overall and per-case completion, the currently running session, terminal status), whereas `mcpscope_benchmark_run_report` returns the **full metrics** (per-case pass rates, tool-call/token stats, per-session metrics, and a cross-case per-tool rollup). Poll status; fetch the report once complete.

## Tool inputs

Inputs use the same canonical field names as CLI commands (adapter-only flags like `--json`, `--url`, `--help` are not part of the shared schema).

### `mcpscope_list`

No inputs.

### `mcpscope_create`

| Field            | Type                              | Required | Description |
|------------------|-----------------------------------|----------|-------------|
| `title`          | string                            | ✓        | Session title |
| `id`             | string                            |          | Optional 4-char session ID |
| `compaction`     | `"none"` \| `"strip-reasoning"`   |          | Compaction strategy |
| `model_config_id`| string                            |          | Optional model config ID to use instead of the default |
| `mcp_profile_ids`| string[]                          |          | Optional list of MCP profile IDs; when provided, replaces the default-enabled selection |

### `mcpscope_send`

| Field        | Type   | Required | Description |
|--------------|--------|----------|-------------|
| `session_id` | string | ✓        | Target session ID |
| `prompt`     | string | ✓        | User prompt text |

### `mcpscope_status`

| Field        | Type   | Required | Description |
|--------------|--------|----------|-------------|
| `session_id` | string | ✓        | Session ID to check |

### `mcpscope_inspect`

| Field  | Type    | Required | Description |
|--------|---------|----------|-------------|
| `id`   | string  | ✓        | Hierarchical ID (e.g. `ABCD`, `ABCD.S`, `ABCD.1T`, `ABCD.4W.1T.2`, `ABCD.4W.1T.2.3-R`). Inspecting a session, setup, step, turn, or round is useful for finding child IDs; inspect the returned part IDs directly for full evidence such as tool payloads, tool results, and part content. |
| `short`| boolean |          | Token counts only, no part content |

### `mcpscope_list_model_configs`

No inputs. Returns a list of all model configs with id, name, connection name, model key, and provider type.

### `mcpscope_list_mcp_profiles`

No inputs. Returns a list of all MCP server profiles with id, name, URL, and default-enabled status.

### `mcpscope_benchmark_create`

| Field         | Type           | Required | Description |
|---------------|----------------|----------|-------------|
| `name`        | string         | ✓        | Human-readable benchmark name |
| `description` | string \| null |          | Optional description |

### `mcpscope_benchmark_list`

No inputs. Returns all benchmarks with id, name, description, case count, and run count.

### `mcpscope_benchmark_inspect`

| Field          | Type   | Required | Description |
|----------------|--------|----------|-------------|
| `benchmark_id` | string | ✓        | Benchmark to inspect (returns the benchmark, its cases, and its runs) |

### `mcpscope_benchmark_add_case`

| Field                       | Type           | Required | Description |
|-----------------------------|----------------|----------|-------------|
| `benchmark_id`              | string         | ✓        | Benchmark to add the case to |
| `prompt`                    | string         | ✓        | The user prompt the case sends |
| `name`                      | string \| null |          | Optional human label |
| `expected_tools_called`     | string[]       |          | Tools that should be called (deterministic check) |
| `expected_tools_not_called` | string[]       |          | Tools that should NOT be called (deterministic check) |

### `mcpscope_benchmark_add_case_from_session`

| Field          | Type           | Required | Description |
|----------------|----------------|----------|-------------|
| `benchmark_id` | string         | ✓        | Benchmark to add the case to |
| `session_id`   | string         | ✓        | Session to extract the initiating prompt from; pre-fills `expected_tools_called` with the tools that session actually called |
| `name`         | string \| null |          | Optional human label |

### `mcpscope_benchmark_run`

| Field             | Type     | Required | Description |
|-------------------|----------|----------|-------------|
| `benchmark_id`    | string   | ✓        | Benchmark to run |
| `case_ids`        | string[] |          | Subset of case ids to run (default: all cases) |
| `repetitions`     | number   |          | Times to run each case (default: 1) |
| `model_config_id` | string   |          | Model config to use (default: the configured default) |
| `mcp_profile_ids` | string[] |          | MCP profiles to enable (default: the configured defaults) |

Returns the run immediately with `status: "pending"`; poll `mcpscope_benchmark_run_status` for progress and `mcpscope_benchmark_run_report` for the full report.

### `mcpscope_benchmark_run_status`

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `run_id` | string | ✓        | Run id to poll |

Returns progress derived from the run record only: `status`, `total_cases`, `total_sessions`, `completed_sessions`, `failed_sessions`, `per_case` completion, `current_session_id`, `error`, and timestamps.

### `mcpscope_benchmark_run_report`

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `run_id` | string | ✓        | Run id to report on |

Heavier than status (loads session traces). Returns the run plus the full metrics report.

## Tool results

All tools return structured results. Each tool registers an `outputSchema` (Zod shape) and returns:

- `structuredContent` — the full result object for clients that support structured output
- `content` — the same result as JSON text (fallback for clients that do not support `outputSchema`)

Error results set `isError: true` and include `{ error: { message, code? } }`.

Result field naming is snake_case throughout (same shapes as CLI `--json` mode). See [CLI.md](CLI.md) for exact result shapes and error codes per operation.

## Backend-owned operation catalog

The tool descriptions, input schemas, output schemas, and execution functions come from the shared backend operation catalog in `backend/src/operations/catalog.ts` and `backend/src/operations/index.ts`. MCP operations execute directly in the backend process — no loopback HTTP.

There is no separate shared package. The backend operation catalog is the single source of truth for both the CLI result types and the MCP tool surface. Backend-only HTTP operations may live nearby in `backend/src/operations/`, but they are not exposed to MCP unless added to the shared catalog.

To verify parity: `npm test` — the parity test suite in `backend/src/mcp/mcp.test.ts` enforces:

- same operation IDs and descriptions
- same input schemas (no adapter-only flags)
- canonical snake\_case field naming in all result shapes
- outputSchema defined for every operation

## Configuration

The MCP interface is hosted on the same port as the backend API (`BACKEND_PORT`, default 3030). No separate process or port is needed.

Example connection string for an MCP client:

```text
http://localhost:3030/mcp
```

Inside Docker:

```text
http://localhost:3030/mcp
```

## Internal analysis MCP endpoint

mcpscope also exposes an internal restricted MCP endpoint for analysis sessions:

```text
http://localhost:3030/mcp/analysis
```

This endpoint is backend-owned and used by `session_analysis` sessions.

Its tool surface is intentionally restricted to:

- `mcpscope_inspect`
- `mcpscope_status`

It is not the general public MCP surface for normal agent use. Its purpose is to let the analysis
workflow inspect persisted mcpscope evidence without exposing broader session-management tools.

See [backlog/completed/SESSION-ANALYSIS.md](backlog/completed/SESSION-ANALYSIS.md) for how this restricted endpoint is used in the shipped analysis
workflow.
