# Benchmark v1 — Phase A (completed)

Shipped on branch `benchmark-v1` (PR #35). Feature 3 of
`candidates/v1-analysis-and-benchmark-plan.md`. The living reference is
[BENCHMARK.md](../../BENCHMARK.md) (data model, API, CLI/MCP, report, and an MCP tutorial for
coding agents); the DB tables are in [DATABASE-SCHEMA.md](../../DATABASE-SCHEMA.md); the
CLI/MCP parity principle is in [AGENTS.md](../../AGENTS.md). Evaluation-design rationale:
`research/benchmark-success-criteria.md`.

This record describes **what was actually built** (Phase A: run + deterministic metrics, no LLM
evaluation). Phase B (richer checks) and Phase C (separate-model LLM judge) remain future work.

## Goal / value (UC2)

An MCP-server tester (or coding agent) builds a **benchmark** — a static, growing test suite for
their MCP server — and executes **runs** against it, getting repeated-run feedback: overall
quality and, specifically, which tools cause issues (descriptions, params, errors, token
efficiency). mcpscope owns session/run creation; the tester never scripts it.

## Vocabulary

- **Benchmark** — the static suite (editable blueprint). First-class persisted object.
- **Case** — one entry in a benchmark: a prompt + optional tool-behavior expectations.
- **Run** — one execution: selects which cases to run and how many **repetitions** of each.
  An immutable snapshot of the cases + settings it ran. Produces sessions + a report.
- **Session** — one repetition of one case within a run (a normal primary session, individually
  inspectable, parented to the run).
- **Check** — an optional deterministic per-session success rule.

## IDs (type-tagged, hierarchical)

The object kind is always tellable from the id, consistent with the session ID scheme (bare
4-char = session):

- **Benchmark** `B-7K3M` · **Case** `B-7K3M.3` (dotted child) · **Run** `R-9QX4` (flat /
  first-class — not nested under the benchmark). No uuids.

## Data model (as built)

Three DB tables (`benchmarks`, `benchmark_cases`, `benchmark_runs` — see DATABASE-SCHEMA.md):

- **Benchmark**: `id, name, description, createdAt, updatedAt`.
- **Case**: `id, benchmarkId, name, prompt, orderIndex, expectedToolsCalled[],
  expectedToolsNotCalled[], sourceSessionId, createdAt, updatedAt`.
- **Run**: `id, benchmarkId, benchmarkName, status, modelConfigId, mcpProfileIds[],
  cases[<snapshot>], repetitions, sessions[{sessionId, sourceCaseId, repetition, status}],
  error, createdAt, updatedAt, startedAt, completedAt`. The effective model/MCP and a **snapshot
  of the selected cases** are recorded at launch.
- **Session**: a normal `primary` session with `parentKind='benchmark'`, `parentId=<run id>`.

**A run is an immutable snapshot spawned from the (editable) benchmark blueprint** — an
association, not composition. The report evaluates against the run's case snapshot, so editing
or deleting the benchmark/cases never alters a past run. Decoupled lifecycles: deleting a
benchmark cascades to its cases but **keeps its runs**; deleting a run deletes its produced
sessions. Authoring: cases are created manually or **extracted from a session** (first user
message + `expectedToolsCalled` pre-filled from the tools that session actually called).

## Execution (as built)

A background **coordinator** drives the run: for each selected case × repetition it creates a
primary session (recorded immediately with status `running`), initializes it, and runs the case
prompt to completion via the existing sequential scheduler, then marks the session
`complete`/`error`. **Strictly sequential** (one job awaited before the next) — runs are
visible in the execution bar as the active init/turn, not as a pending queue. **Cold runs**:
each session is fresh. A cheap, pollable **run progress** (`benchmark_run_status`) is derived
from the run record alone (status, completed/total sessions, per-case completion, current
session) — distinct from the heavier report.

## Metrics & report (as built; compute-on-read)

Computed on read from persisted session state, evaluated against the run's case snapshot. Leads
with the **per-tool rollup** (the "which tools cause issues" scorecard):

- **Per tool:** `calls`, `errors`, `error_rate`, `result_payload_chars` (tool-result size),
  `cases_used_in`.
- **Per case:** `completed` count; tool error count; **tool-call count** and **total-token**
  distributions (min/median/mean/max/stddev — the latter surfaces cross-repetition variation);
  and, when the case defines checks, **success rate + pass@k (any) + pass^k (all)**.
- **Per session:** terminal status / completed, tool-call & tool-error counts, tools called,
  per-tool counts, token totals (prompt/completion/reasoning/total), final answer.

Not built (deferred refinements): per-tool token attribution, tool **parameter** coverage, and
`valid_tool_arguments` (args-validate-vs-schema) as a metric.

## Success checks (as built) — deterministic, tool-behavior only

Checks are an **optional** lightweight skeleton; a case may define none (it still produces full
metrics). When present, a session passes when: all `expectedToolsCalled` were called, no
`expectedToolsNotCalled` were called, no tool errored, and the session completed. No answer-text
or numeric oracle — answer/qualitative correctness is deferred to the Phase C separate-model
judge. **Never self-judge** (research-backed). Success is reported as a rate plus pass@k/pass^k
over the repetitions.

## Surfaces (as built)

- **CLI + MCP (mirrored).** Eight shared **operation-catalog** operations (snake_case):
  `benchmark_create`, `benchmark_list`, `benchmark_inspect`, `benchmark_add_case`,
  `benchmark_add_case_from_session`, `benchmark_run`, `benchmark_run_status`,
  `benchmark_run_report`. Each is both a `mcpscope <id>` CLI command and a `mcpscope_<id>` MCP
  tool (catalog grew 7 → 15); parity is enforced by `commandCatalog.test` + `mcp.test`. An MCP
  walkthrough for coding agents is in BENCHMARK.md.
- **UI.** Three-section sidebar (Benchmarks / Benchmark runs / Sessions), a benchmark detail view
  (case **cards** + runs table), a run-launch dialog (model + MCP + cases + repetitions), a run
  report (per-tool scorecard + per-case detail + per-case session list), an MCP **tool picker**
  for expected/forbidden tools, and "extract case from session". The frontend uses its own
  camelCase HTTP routes (a separate surface, not part of the CLI/MCP parity contract).

## Decisions (as built)

- Benchmark/case/run are **DB-primary** first-class objects, editable via UI/CLI/MCP.
- **Type-tagged hierarchical IDs** (`B-`/`R-`/dotted case); no uuids.
- **Run = immutable snapshot**, independent lifecycle from its benchmark.
- **Cold runs**; **sequential** execution; **compute-on-read** reports (caching deferred).
- Checks are **tool-behavior only**, optional; no answer oracle in case definitions.

## Deferred / future work

- **Phase B** — richer deterministic checks: promote `valid_tool_arguments`, add tool-parameter
  coverage and per-tool token attribution, and an optional `answer_contains`.
- **Phase C** — optional LLM-judged success using a *separate, stronger* judge model (never the
  model under test).
- `candidates/benchmark-inspect-id-unification.md` — teach the generic `inspect` op to resolve
  `B-`/`R-` ids (the id predicates in `hierarchicalIds.ts` are scaffolding for this).
- Concurrency, regression diffing between runs (`candidates/benchmark-automation.md`), report
  caching.

## Related

`candidates/v1-analysis-and-benchmark-plan.md` (umbrella) ·
`research/benchmark-success-criteria.md` (criteria + vocabulary research) ·
`candidates/benchmark-automation.md`, `candidates/session-batch-runs.md` (future framing).
