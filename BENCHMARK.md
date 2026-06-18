# Benchmark reference

mcpscope benchmarks let an MCP-server tester define a reusable test suite of prompts and
re-run it, getting repeated-run feedback — overall quality and, specifically, which tools
cause issues (coverage, errors, token efficiency). mcpscope owns session/run creation; you
do not script it.

This is the **Phase A** surface (run + deterministic metrics, no LLM evaluation). See
[backlog/completed/benchmark-v1.md](backlog/completed/benchmark-v1.md) for the completed
Phase A record and [backlog/research/benchmark-success-criteria.md](backlog/research/benchmark-success-criteria.md)
for the evaluation-design research.

## Vocabulary

- **Benchmark** — a static suite (a named set of cases). Persisted, first-class.
- **Case** — one prompt (+ optional tool-behavior expectations) in a suite.
- **Run** — one execution of a benchmark: picks a model, MCP server(s), which cases, and how
  many repetitions of each. Produces one **session** per case × repetition and a report.
- **Session** — one repetition of one case (a normal mcpscope primary session, individually
  inspectable, parented to the run).
- **Check** — an optional deterministic per-session success rule. Cases without checks still
  produce full metrics.

Individual sessions outside a benchmark are unchanged — benchmarks are purely additive.

## IDs

IDs are type-tagged so the kind is always tellable, consistent with the session
hierarchical-ID scheme (a bare 4-char code is a session):

- **Benchmark**: `B-7K3M` (`B-` prefix + 4-char code).
- **Case**: `B-7K3M.3` (case 3 of that benchmark — a dotted child).
- **Run**: `R-9QX4` (`R-` prefix + 4-char code) — **flat / first-class**, not nested under
  the benchmark.

A run is **inspectable like a session** (its report + child sessions) and shows up in the
left-pane tree as a container of its sessions.

## Data model

The backing tables (`benchmarks`, `benchmark_cases`, `benchmark_runs`) and their columns are
defined in [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md); this section describes the domain shape.

- **Benchmark** (editable blueprint): `id, name, description, createdAt, updatedAt`.
- **Case**: `id, benchmarkId, name, prompt, orderIndex, expectedToolsCalled[],
  expectedToolsNotCalled[], sourceSessionId, createdAt, updatedAt`.
  - `name` is an optional human label (falls back to the prompt for display).
  - `sourceSessionId` records the session a case was extracted from, if any.
- **Run** (immutable snapshot spawned from a benchmark): `id, benchmarkId, benchmarkName,
  status, modelConfigId, mcpProfileIds[], cases[{sourceCaseId, name, prompt,
  expectedToolsCalled[], expectedToolsNotCalled[]}], repetitions, sessions[{sessionId,
  sourceCaseId, repetition}], error, createdAt, updatedAt, startedAt, completedAt`.

A benchmark is an **editable blueprint**; a run is a **first-class, independent snapshot** of
the cases + settings it ran (an *association*, not composition). At launch the run resolves
and records the effective model/MCP and snapshots the selected cases, so **editing or deleting
the benchmark or its cases never alters a past run or its report**. Model and MCP selection
are run-level (the point is to run the same cases against different model/MCP combinations);
cases hold only the prompt + expectations.

### Lifecycles

- Deleting a **benchmark** cascades to its **cases** but leaves its **runs** intact.
- Deleting a **run** removes its produced sessions.
- Deleting a **case** removes it from the blueprint; past runs keep their snapshot.

## Authoring cases

Two ways to create a case:

1. **From a session (recommended)** — extract the session's first user message into a case,
   pre-filling `expectedToolsCalled` with the tools that session actually called (an editable
   default). This turns observed behavior into a checkable expectation cheaply.
2. **Manually** — provide a prompt (and optionally expected/forbidden tools) directly.

## Agent-facing surface (CLI + MCP)

The agent-facing benchmark capabilities now live in the shared **operation catalog**
(`backend/src/operations/catalog.ts`), so each is exposed identically through both adapters:
every operation is both a `mcpscope <id>` CLI command and a `mcpscope_<id>` MCP tool (CLI/MCP
parity). These ops return **snake_case** results, the operation-catalog convention. The eight
benchmark operations are:

`benchmark_create`, `benchmark_list`, `benchmark_inspect`, `benchmark_add_case`,
`benchmark_add_case_from_session`, `benchmark_run`, `benchmark_run_status`,
`benchmark_run_report`.

See [CLI.md](CLI.md) for the CLI commands and [MCP.md](MCP.md) for the MCP tools.

The frontend keeps a separate set of **camelCase** HTTP routes (below); those are not part of
the CLI/MCP parity surface.

## HTTP API

The frontend benchmark routes use **camelCase** JSON (consistent with the session/trace HTTP
API the frontend consumes — distinct from the snake_case operation catalog used by the CLI/MCP
surface). These camelCase routes are not part of the MCP operation catalog.

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/api/benchmarks` | — | `{ benchmarks: [{...benchmark, caseCount, runCount}] }` |
| `POST` | `/api/benchmarks` | `{ name, description? }` | `{ benchmark }` |
| `GET` | `/api/benchmarks/:id` | — | `{ benchmark, cases[], runs[] }` |
| `PATCH` | `/api/benchmarks/:id` | `{ name?, description? }` | `{ benchmark }` |
| `DELETE` | `/api/benchmarks/:id` | — | `204` (cascades to cases; runs are kept) |
| `POST` | `/api/benchmarks/:id/cases` | `{ prompt, name?, expectedToolsCalled?, expectedToolsNotCalled? }` | `201 { case }` |
| `POST` | `/api/benchmarks/:id/cases/from-session` | `{ sessionId, name? }` | `201 { case }` |
| `PATCH` | `/api/benchmark-cases/:caseId` | `{ name?, prompt?, orderIndex?, expectedToolsCalled?, expectedToolsNotCalled? }` | `{ case }` |
| `DELETE` | `/api/benchmark-cases/:caseId` | — | `204` |
| `POST` | `/api/benchmarks/:id/runs` | `{ caseIds?, repetitions?, modelConfigId?, mcpProfileIds? }` | `202 { run }` |
| `GET` | `/api/benchmark-runs/:runId` | — | `{ run, report }` |
| `DELETE` | `/api/benchmark-runs/:runId` | — | `204` (also deletes the run's sessions) |

A run launch returns immediately (`202`); a background coordinator drives the sessions
sequentially through the scheduler. Poll `GET /api/benchmark-runs/:runId` for `run.status`
(`pending` → `running` → `complete`/`error`) and the computed report.

### Operation-backed routes (snake_case)

The same catalog benchmark operations are also mounted under `/api/operations/*`. These return
the operation result verbatim (snake_case) and are what the CLI calls; the MCP server exposes
the identical operations as `mcpscope_<id>` tools.

| Method | Path | Operation |
|---|---|---|
| `POST` | `/api/operations/benchmark-create` | `benchmark_create` |
| `GET` | `/api/operations/benchmarks` | `benchmark_list` |
| `GET` | `/api/operations/benchmarks/:benchmarkId` | `benchmark_inspect` |
| `POST` | `/api/operations/benchmark-add-case` | `benchmark_add_case` |
| `POST` | `/api/operations/benchmark-add-case-from-session` | `benchmark_add_case_from_session` |
| `POST` | `/api/operations/benchmark-run` | `benchmark_run` |
| `GET` | `/api/operations/benchmark-runs/:runId/status` | `benchmark_run_status` |
| `GET` | `/api/operations/benchmark-runs/:runId/report` | `benchmark_run_report` |

## CLI / MCP

The eight `benchmark_*` operations are flat, catalog-backed commands, each exposed identically
as a `mcpscope <id>` CLI command and a `mcpscope_<id>` MCP tool. The exact per-command flags,
arguments, and text/JSON output live in one place — [CLI.md](CLI.md) (Benchmark commands) and
[MCP.md](MCP.md) (tool inputs/results) — and are not repeated here to avoid drift. The
end-to-end worked example is the [tutorial](#tutorial-benchmark-an-mcp-server-via-mcp-for-coding-agents)
below.

### Run progress vs report

A run is launched in the background and tracked through two distinct reads:

- **`benchmark_run_status`** — cheap, pollable **progress** derived from the run record only
  (no session traces loaded): overall and per-case completion, total/completed/failed session
  counts, the currently running session, terminal status, error, and timestamps. The
  coordinator records each session at creation with a `running`/`complete`/`error` status, so
  progress reflects in-flight work as it happens.
- **`benchmark_run_report`** — the heavy, compute-on-read **metrics** report (loads session
  traces): per-case pass rates, tool-call/token stats, per-session metrics, and the cross-case
  per-tool rollup described below.

`benchmark_run --wait` polls status to a terminal state before printing.

## Report and metrics

The report is computed on read from the produced sessions (nothing is cached). It leads with
a **per-tool rollup** — the "which tools cause issues" scorecard — then per-case detail.

- **Per tool (rollup):** calls, errors, error rate, result-payload size, how many cases used it.
- **Per case:** completed count; tool-call and total-token distributions (min/median/mean/
  max/stddev — token *variation* across repetitions is itself a signal); per-tool counts; and,
  when the case defines checks, success rate plus **pass@k** (any repetition passed) and
  **pass^k** (all repetitions passed — reliability). The gap between pass@k and pass^k is the
  key non-determinism signal.

### Success checks (optional, deterministic)

A case may define tool-behavior checks: `expectedToolsCalled` (each called ≥ once) and
`expectedToolsNotCalled` (never called). A repetition passes when those hold **and** no tool
errored **and** the session completed. Cases with no checks report metrics only (no verdict).
Answer/qualitative correctness is deliberately **not** checked here — that is deferred to a
future separate-model LLM evaluation (never self-judging). See the research note.

## Tutorial: benchmark an MCP server via MCP (for coding agents)

You are a coding agent iterating on an MCP server and want a repeatable check. mcpscope
exposes the benchmark workflow as MCP tools (`mcpscope_*`); the CLI mirrors them
one-for-one (`mcpscope <id>`), so every step below works identically from the shell.

**Prerequisite (one-time, via the UI):** register an LM connection + model config and the
MCP server profile under test in mcpscope's configuration. Discover their ids with the
`mcpscope_list_model_configs` and `mcpscope_list_mcp_profiles` tools.

1. **Create a benchmark** (the reusable suite):
   `mcpscope_benchmark_create { "name": "weather server" }` → `{ "benchmark": { "id": "B-7K3M", … } }`
2. **Add cases** — one prompt each, with optional deterministic tool-behavior expectations:
   `mcpscope_benchmark_add_case { "benchmark_id": "B-7K3M", "prompt": "What's the forecast for Paris tomorrow?", "expected_tools_called": ["get_forecast"] }` → `{ "case": { "id": "B-7K3M.1", … } }`.
   To turn a session you already ran into a case (pre-fills the tools it actually called):
   `mcpscope_benchmark_add_case_from_session { "benchmark_id": "B-7K3M", "session_id": "AB12" }`.
3. **Launch a run** — pick the model, MCP server(s), cases, and repetitions (all optional;
   defaults = the configured default model, the case's benchmark, all cases, 1 repetition):
   `mcpscope_benchmark_run { "benchmark_id": "B-7K3M", "repetitions": 5, "model_config_id": "<id>", "mcp_profile_ids": ["<id>"] }` → `{ "run": { "id": "R-9QX4", "status": "pending" } }`.
4. **Follow progress** — poll until terminal:
   `mcpscope_benchmark_run_status { "run_id": "R-9QX4" }` → `{ "status": "running", "completed_sessions": 7, "total_sessions": 25, "per_case": [{ "name": …, "completed": …, "total": … }], "current_session_id": … }`. Stop when `status` is `complete` or `error`.
5. **Inspect the result**:
   `mcpscope_benchmark_run_report { "run_id": "R-9QX4" }` → `{ "run", "report" }`.
   - `report.per_tool` is the **tool scorecard** — per tool: `calls`, `errors`, `error_rate`,
     `result_payload_chars`, `cases_used_in`. High `error_rate` or oversized payloads point at
     a tool whose description/params/behavior need work.
   - `report.cases` is per case: `success_rate`, `pass_at_k` (any repetition passed),
     `pass_hat_k` (all passed — reliability), `tool_error_count`, and tool-call/token stats.
6. **Iterate** — change the server, run again, compare reports. Each run is an immutable
   snapshot, so past results stay valid as you edit the benchmark.

## Known limitations (Phase A)

- Runs are sequential (one scheduler queue); no concurrency.
- A server restart mid-run leaves the run `running` (the in-memory queue is cleared; no resume yet).
- No LLM-judged success and no answer-text checks yet (deferred).
