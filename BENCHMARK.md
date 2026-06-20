# Benchmark reference

mcpscope benchmarks let an MCP-server tester define a reusable test suite of prompts and
re-run it. Quality is measured in two complementary layers:

1. **Deterministic metrics** (always computed from the produced sessions) — repeated-run
   feedback on which tools cause issues: coverage, errors, token efficiency, plus optional
   pass/fail tool-behavior **checks**.
2. **LLM evaluation** (optional, run after a benchmark run) — a separate **judge model** scores
   each session against a per-case **rubric**, covering the qualitative answer-quality
   dimension that deterministic checks can't. This is **not** a separate judging engine: an
   evaluation is implemented as a `benchmark_evaluation` **analysis session** — the same
   workflow framework that powers session analysis (pushed evidence + pull-on-demand via the
   read-only `mcpscope_inspect` tool, structured output, scheduler-driven steps). The analysis
   subsystem *is* how benchmark evaluation works; see [Evaluation](#evaluation-llm-rubric-judging).

mcpscope owns session/run/evaluation creation; you do not script it.

See [backlog/completed/benchmark-v1.md](backlog/completed/benchmark-v1.md) for the
deterministic-metrics record and [backlog/research/benchmark-success-criteria.md](backlog/research/benchmark-success-criteria.md)
for the evaluation-design research. The shared analysis framework is documented in
[backlog/completed/SESSION-ANALYSIS.md](backlog/completed/SESSION-ANALYSIS.md) and
[ARCHITECTURE.md](ARCHITECTURE.md).

## Vocabulary

- **Benchmark** — a static suite (a named set of cases). Persisted, first-class.
- **Case** — one prompt (+ optional tool-behavior expectations) in a suite.
- **Run** — one execution of a benchmark: picks a model, MCP server(s), which cases, and how
  many repetitions of each. Produces one **session** per case × repetition and a report.
- **Session** — one repetition of one case (a normal mcpscope primary session, individually
  inspectable, parented to the run).
- **Check** — an optional deterministic per-session success rule. Cases without checks still
  produce full metrics.
- **Rubric** — an optional ordered list of scored criteria on a case (`{id, description,
  points}`), authored in natural language. Drives the LLM evaluation; absent ⇒ a case is not
  LLM-scored.
- **Evaluation** — one LLM-judging pass over a completed run with a chosen **judge model**.
  Repeatable: 0..N per run (e.g. compare judge models). Spawns one `benchmark_evaluation`
  **analysis session** per run-session (a judge session, parented to the session it scores).

Individual sessions outside a benchmark are unchanged — benchmarks are purely additive.

## IDs

IDs are type-tagged so the kind is always tellable, consistent with the session
hierarchical-ID scheme (a bare 4-char code is a session):

- **Benchmark**: `B-7K3M` (`B-` prefix + 4-char code).
- **Case**: `B-7K3M.3` (case 3 of that benchmark — a dotted child).
- **Run**: `R-9QX4` (`R-` prefix + 4-char code) — **flat / first-class**, not nested under
  the benchmark.
- **Evaluation**: `E-2F8P` (`E-` prefix + 4-char code) — one judging pass over a run. Its
  per-session judge sessions are ordinary analysis sessions (bare 4-char ids), parented to the
  run-sessions they score.

A run is **inspectable like a session** (its report + child sessions) and shows up in the
left-pane tree as a container of its sessions. The verdict notes cite these hierarchical IDs,
so a finding always points back at the exact session/turn/tool-call it refers to.

## Data model

The backing tables (`benchmarks`, `benchmark_cases`, `benchmark_runs`,
`benchmark_evaluations`) and their columns are defined in
[DATABASE-SCHEMA.md](DATABASE-SCHEMA.md); this section describes the domain shape.

- **Benchmark** (editable blueprint): `id, name, description, createdAt, updatedAt`.
- **Case**: `id, benchmarkId, name, prompt, orderIndex, expectedToolsCalled[],
  expectedToolsNotCalled[], rubric[{id, description, points}], sourceSessionId, createdAt,
  updatedAt`.
  - `name` is an optional human label (falls back to the prompt for display).
  - `sourceSessionId` records the session a case was extracted from, if any.
  - `rubric` is the optional scored-criteria list used by LLM evaluation (empty by default).
- **Run** (immutable snapshot spawned from a benchmark): `id, benchmarkId, benchmarkName,
  status, modelConfigId, mcpProfileIds[], cases[{sourceCaseId, name, prompt,
  expectedToolsCalled[], expectedToolsNotCalled[], rubric[]}], repetitions,
  sessions[{sessionId, sourceCaseId, repetition}], error, createdAt, updatedAt, startedAt,
  completedAt`. The case snapshot includes the rubric, so an evaluation always judges against
  the rubric as it was at run time.
- **Evaluation** (one judging pass over a run): `id, runId, judgeModelConfigId, judgeTemperature,
  status, sessions[{runSessionId, analysisSessionId, status}], error, createdAt, updatedAt`. A
  thin grouping record holding the chosen judge config (model + temperature); it links each
  run-session to the `benchmark_evaluation` analysis session
  that judged it. **Scores are not stored** — they are computed on read from the judge
  sessions' verdict artifacts (see [Evaluation](#evaluation-llm-rubric-judging)).

A benchmark is an **editable blueprint**; a run is a **first-class, independent snapshot** of
the cases + settings it ran (an *association*, not composition). At launch the run resolves
and records the effective model/MCP and snapshots the selected cases, so **editing or deleting
the benchmark or its cases never alters a past run or its report**. Model and MCP selection
are run-level (the point is to run the same cases against different model/MCP combinations);
cases hold only the prompt + expectations.

### Lifecycles

- Deleting a **benchmark** cascades to its **cases** but leaves its **runs** intact.
- Deleting a **run** removes its produced sessions and its **evaluations** (the grouping
  records cascade; the judge analysis sessions are children of the run-sessions and go with
  them).
- Deleting a **case** removes it from the blueprint; past runs keep their snapshot (rubric
  included).
- Deleting an **evaluation** removes that pass and its judge sessions only; the run, its
  sessions, and other evaluation passes are untouched.

## Authoring cases

Two ways to create a case:

1. **From a session (recommended)** — extract the session's first user message into a case,
   pre-filling `expectedToolsCalled` with the tools that session actually called (an editable
   default). This turns observed behavior into a checkable expectation cheaply.
2. **Manually** — provide a prompt (and optionally expected/forbidden tools) directly.

A case may also carry a **rubric** (scored criteria) for LLM evaluation — set it when creating
or editing a case (UI rubric editor, or the `rubric` field on `benchmark_add_case` /
`PATCH /api/benchmark-cases/:id`). The rubric is independent of the deterministic checks: a
case can have checks, a rubric, both, or neither.

## Agent-facing surface (CLI + MCP)

The agent-facing benchmark capabilities now live in the shared **operation catalog**
(`backend/src/operations/catalog.ts`), so each is exposed identically through both adapters:
every operation is both a `mcpscope <id>` CLI command and a `mcpscope_<id>` MCP tool (CLI/MCP
parity). These ops return **snake_case** results, the operation-catalog convention. The ten
benchmark operations are:

`benchmark_create`, `benchmark_list`, `benchmark_inspect`, `benchmark_add_case`,
`benchmark_add_case_from_session`, `benchmark_run`, `benchmark_run_status`,
`benchmark_run_report`, `benchmark_evaluate`, `benchmark_run_evaluations`.

`benchmark_add_case` accepts an optional `rubric`; `benchmark_evaluate` launches an LLM
evaluation pass and `benchmark_run_evaluations` reads back the scored passes. See
[CLI.md](CLI.md) for the CLI commands and [MCP.md](MCP.md) for the MCP tools.

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
| `POST` | `/api/benchmarks/:id/cases` | `{ prompt, name?, expectedToolsCalled?, expectedToolsNotCalled?, rubric? }` | `201 { case }` |
| `POST` | `/api/benchmarks/:id/cases/from-session` | `{ sessionId, name? }` | `201 { case }` |
| `PATCH` | `/api/benchmark-cases/:caseId` | `{ name?, prompt?, orderIndex?, expectedToolsCalled?, expectedToolsNotCalled?, rubric? }` | `{ case }` |
| `DELETE` | `/api/benchmark-cases/:caseId` | — | `204` |
| `POST` | `/api/benchmarks/:id/runs` | `{ caseIds?, repetitions?, modelConfigId?, mcpProfileIds? }` | `202 { run }` |
| `GET` | `/api/benchmark-runs/:runId` | — | `{ run, report }` |
| `DELETE` | `/api/benchmark-runs/:runId` | — | `204` (also deletes the run's sessions + evaluations) |
| `POST` | `/api/benchmark-runs/:runId/evaluations` | `{ judgeModelConfigId, temperature? }` | `202 { evaluation }` |
| `GET` | `/api/benchmark-runs/:runId/evaluations` | — | `{ evaluations: [{...evaluation, score}] }` |
| `POST` | `/api/benchmark-evaluations/:evaluationId/retry` | — | `202 { evaluation }` (re-judges failed/incomplete sessions) |
| `DELETE` | `/api/benchmark-evaluations/:evaluationId` | — | `204` (also deletes the pass's judge sessions) |

A run launch returns immediately (`202`); a background coordinator drives the sessions
sequentially through the scheduler. Poll `GET /api/benchmark-runs/:runId` for `run.status`
(`pending` → `running` → `complete`/`error`) and the computed report.

An evaluation launch likewise returns immediately (`202`); a background coordinator drives one
judge analysis session per run-session through the same scheduler. Poll
`GET /api/benchmark-runs/:runId/evaluations` for each pass's `status` and computed `score`.

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
| `POST` | `/api/operations/benchmark-evaluate` | `benchmark_evaluate` |
| `GET` | `/api/operations/benchmark-runs/:runId/evaluations` | `benchmark_run_evaluations` |

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
Answer/qualitative correctness is deliberately **not** checked here — that is the job of the
**LLM evaluation** below (a separate judge model, never self-judging).

## Evaluation (LLM rubric judging)

Deterministic metrics can't tell you whether the *answer* was good. Evaluation adds that
dimension: after a run completes, a separate **judge model** scores each session against its
case **rubric**.

**This is the analysis subsystem, applied to benchmarking.** An evaluation does not introduce
a new judging engine — it launches one `benchmark_evaluation` **analysis session** per
run-session, using the exact same framework as session analysis:

- **Pushed evidence** — the judge session is bootstrapped with a deterministic `inspect`
  summary of the session under test (prompt, tool calls, final answer), so the common case
  needs no extra reads.
- **Pull on demand** — the judge runs against the **read-only `/mcp/analysis` endpoint** and
  can call `mcpscope_inspect` to pull more detail (a specific turn, a tool result's full
  payload) when a criterion needs it. This pull-when-needed ability is the differentiator: the
  judge sees a cheap summary by default but can dig into the exact evidence.
- **Structured output** — the single judge step returns a validated verdict and writes it as
  an artifact, exactly like other analysis steps; the scheduler drives the step.

Because it *is* an analysis session, each judge session is individually inspectable in the
left-pane tree (parented to the session it scored), retryable, and reuses analysis
persistence, prompting, and scheduling. The shared framework — `AnalysisSessionBase`,
`WorkflowStep`, the workflow registry — is documented in
[ARCHITECTURE.md](ARCHITECTURE.md) and [backlog/completed/SESSION-ANALYSIS.md](backlog/completed/SESSION-ANALYSIS.md);
the benchmark-specific pieces live in `backend/src/analysis/benchmarkEvaluation/`.

### Rubric and verdict

A rubric is an ordered list of criteria, each `{ id, description, points }`, authored in
natural language (no predicate DSL). The judge returns a small, stable verdict per session:
per-criterion `{ id, points, note }` plus an optional overall `comment`. Notes must **cite the
hierarchical IDs** they refer to (session/turn/tool-call), so every judgment is traceable. The
backend clamps each awarded points to `[0, criterion.points]` and stores the verdict as an
artifact on the judge session.

### Guardrails

- **Separate judge model, never self-judge** — you choose the `judgeModelConfigId`; it is a
  distinct model selection from the one under test.
- **Deterministic judging by default** — the judge runs at temperature 0 with structured output;
  the temperature is selectable per pass (stored on the evaluation) if you want to probe judge
  stability, but 0 is the recommended default.
- **After-the-fact and repeatable** — evaluation is decoupled from the run. Launch 0..N passes
  per run, e.g. to compare judge models. Each pass is its own `Evaluation` record.

### Scores (computed on read)

Nothing is cached. `benchmark_run_evaluations` (and `GET …/evaluations`) reads each pass's
judge-session verdict artifacts and computes, per pass:

- **Per session:** `awarded / max → pct` from the verdict.
- **Per case:** the distribution of session `pct` across repetitions (min/median/mean/max/
  stddev — the spread is the reliability signal).
- **Overall:** the mean session `pct` across the pass.

A session whose judge errored (no verdict) is listed but excluded from the stats.

### Failure handling & retry

A judge-session failure (e.g. the judge model isn't loaded) does **not** abort the pass: that
session is marked `error`, the coordinator continues judging the rest, and the evaluation ends
`error` if any session failed. Nothing is auto-recovered.

To recover, fix the cause (e.g. load the judge model) and **Retry the evaluation**
(`POST .../retry`, or the Retry button on a failed pass). Retry re-judges only the
failed/incomplete run-sessions — clearing each stale judge session and re-running it through the
normal launch (init **and** the judge step) — while keeping sessions that already produced a
verdict. Scores recompute on read, so the pass's score fills in as the re-judged sessions
complete. (A whole pass can also just be deleted and re-run, and individual judge sessions remain
inspectable/retryable in the run tree like any analysis session.)

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
6. **(Optional) LLM-evaluate answer quality** — for cases that carry a rubric (set it at
   authoring time, e.g. `mcpscope_benchmark_add_case { …, "rubric": [{ "id": 1, "description":
   "Reports the correct forecast", "points": 2 }] }`), launch a judging pass with a *separate*
   model:
   `mcpscope_benchmark_evaluate { "run_id": "R-9QX4", "judge_model_config_id": "<judge-id>" }`
   → `{ "evaluation": { "id": "E-2F8P", "status": "pending" } }`. Then poll the scores:
   `mcpscope_benchmark_run_evaluations { "run_id": "R-9QX4" }` →
   `{ "evaluations": [{ "id": "E-2F8P", "status": "complete", "score": { "overall_pct": …,
   "cases": [{ "name": …, "pct_stats": {…}, "sessions": [{ "analysis_session_id": …, "awarded":
   …, "max": … }] }] } }] }`. Open any `analysis_session_id` to read the judge's verdict and
   reasoning (it cites the exact session/turn IDs it scored).
7. **Iterate** — change the server, run again, compare reports (and re-evaluate). Each run is an
   immutable snapshot, so past results stay valid as you edit the benchmark.

## Known limitations

- Runs **and** evaluations are sequential (one scheduler queue); no concurrency.
- A server restart mid-run (or mid-evaluation) leaves it `running` (the in-memory queue is
  cleared; no resume yet).
- Evaluation scores are computed on read from verdict artifacts; there is no stored aggregate
  or cross-run/cross-judge comparison view yet (compare passes by reading each one).
