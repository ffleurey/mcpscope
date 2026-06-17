# Benchmark v1 (spec in refinement)

Feature 3 of `candidates/v1-analysis-and-benchmark-plan.md`. Success-criteria and vocabulary
research is in `research/benchmark-success-criteria.md` (it gates the criteria detail only,
not the run+stats core).

## Goal / value (UC2)

Let an MCP-server tester (or coding agent) build a **benchmark** — a static, growing test
suite for their MCP server — and execute **runs** against it, so they focus on the server and
get repeated-run feedback: overall quality and, specifically, which tools cause issues
(descriptions, parameters, performance, token efficiency). A coding agent working on an MCP
server gradually grows the benchmark as its test suite. mcpscope owns session/run creation;
the tester never scripts it.

## Vocabulary (aligned with eval-framework practice; see research note)

- **Benchmark** — the static suite. A first-class, persisted object (DB), CRUD via UI + CLI + MCP.
- **Case** — one entry in a benchmark (a prompt + expectations). (Not "test case": this is
  non-deterministic and yields a distribution, not green/red.)
- **Run** — one execution of a benchmark: selects which cases to run and how many
  **repetitions** of each (to handle non-determinism). Produces sessions + statistics + a report.
- **Session** — one repetition of one case within a run (mcpscope's existing unit; = an
  Inspect "epoch"/"trial"). Normal, individually inspectable session under the run.
- **Check** — a deterministic per-session success rule (community term: "scorer"/"assertion").
- Report per case as **success rate + pass@k (any) + pass^k (all)** over its repetitions.

## Phasing

- **Phase A — run + deterministic stats, NO checks, NO LLM (the must-have).** Define a
  benchmark, execute a run, collect per-session metrics, produce an aggregate report. Must be
  useful on its own (coverage + token efficiency + error rates), before any success notion.
- **Phase B — deterministic checks → per-case success rate (pass@k / pass^k).** Depends on the
  research note. First check set is intentionally tool-behavior based (below).
- **Phase C — optional LLM-judged check, using a SEPARATE judge model (deferred).** Never the
  model under test; never self-judging (research-backed). This is where most of the
  qualitative-success value will come from — V1 only needs a solid skeleton for it to land on.

Metrics (A) never depend on checks (B).

## Data model (DB-primary)

- **Benchmark**: `{ id, name, description?, cases[] }`. Persisted, first-class. Default
  model/MCP profiles may be associated but are overridable per run.
- **Case**: `{ id, benchmark_id, prompt, order, expect?: <checks, Phase B> }`. Added/edited
  incrementally (a coding agent grows the suite over time).
- **Run**: `{ id, benchmark_id, created_at, model_config_id, mcp_profile_ids[],
  case_selection (all | subset of case ids), repetitions_per_case, status }`. A run is an
  execution; it selects cases + repetitions. Persisted.
- **Session**: existing primary session, created with `parentKind='benchmark'` and tagged with
  its `run_id` + `case_id`, runs the case prompt to completion via the scheduler.
- **Report**: derived from persisted session state, aggregated per case and rolled up per tool,
  **computed on read** for V1 (runs are not large at this stage; add caching later if needed).

## What already exists vs what is new

Reuse: the `benchmark` container *type* and parent rule (`primary` may have a `benchmark`
parent) in `executionModel.ts`/`sessionValidation.ts`; the parent-on-create mechanism
(analysis sessions already set `parentKind`/`parentId`); the sequential scheduler; explicit
model/MCP profile selection on create (PR #32); per-part token/tool/error data; trace inspection.

New: there is currently **no** operation, repository surface, or persistence for benchmarks,
cases, or runs (the container is a type only). Benchmark v1 adds: benchmark/case/run CRUD
(DB + operations + UI/CLI/MCP), run orchestration, the deterministic evaluator, and the report.

## Metrics to collect (Phase A)

Three families, all from persisted session state:

1. **Coverage** (test-coverage view): per-tool call counts across the run; **parameter
   coverage** — which parameters / argument shapes have been exercised per tool (so the tester
   sees untested params). Aggregated per tool across all sessions.
2. **Context / token efficiency**: token counts per session, per tool, and per tool-call;
   tool-result payload size (tokens) per tool — to surface tools returning large payloads of
   which most is unused (flag outliers; precise "ignored" detection is a future refinement);
   and **variation across repetitions** — token distribution (min/median/mean/max/stddev) per
   case, so the tester sees whether repeated runs are stable or vary wildly.
3. **Reliability**: tool-call error rate (overall and per tool); per-case **success rate +
   pass@k + pass^k** over repetitions (Phase B once checks exist; Phase A reports error/
   completion stats only).

## Success checks (Phase B) — deterministic, tool-behavior only

V1 checks are a lightweight, **optional** skeleton — a case definition must NOT require a
formal, brittle answer oracle. Most of the success value will come from the Phase C LLM
evaluation; the deterministic checks only anchor on tool behavior (objective, reproducible,
not gameable):

- `expected_tools_called` — named tools each called ≥ once.
- `expected_tools_not_called` — named tools must not be called.
- obvious-failure detection: no tool errors; the session completed (final answer produced, did
  not hit the tool-round limit / bail).

No answer-text checks in V1 (`answer_contains` and `answer_number` are both out) — answer /
qualitative correctness, including numeric, is entirely a Phase C separate-judge concern.
`valid_tool_arguments` (args validate vs each tool's input schema) is collected as a **metric**
in Phase A and is a strong criterion candidate later. **A case with no checks is valid**: it
still produces full Phase A metrics and can be judged by the Phase C evaluation.

## Surfaces

- **CLI / MCP** (primary for UC2): full benchmark/case CRUD (a coding agent grows the suite),
  start a run (select cases + repetitions; returns run id), poll status, fetch the report
  (`--json`).
- **UI**: manage benchmarks/cases, launch + monitor runs, view the report (tool-quality
  rollup as the headline — see below), drill into individual sessions.

## Report framing (product instinct to confirm)

Lead with the **per-tool rollup** — called-rate, error-rate, arg/param coverage, token cost
per tool, variation — i.e. the benchmark is fundamentally a **tool-quality scorecard driven by
prompts**, with per-case success rate (pass@k/pass^k) as the second view. This makes Phase A
useful before any checks exist and matches "help them find which tools cause issues."

## Out of scope (V1)

LLM-judged success (Phase C); self-judging (never); rich assertion DSL; tool-call ordering
checks; concurrent runs (scheduler stays sequential); cold runs only (each session is fresh —
the realistic test); regression diffing between two runs (future,
`candidates/benchmark-automation.md`).

## Open decisions (resolved / remaining)

- Definitions in **DB as first-class objects**, editable via UI/CLI/MCP. (resolved)
- **Cold runs** — each session fresh. (resolved)
- Vocabulary: benchmark / case / run / session / check. (resolved)
- Reports **computed on read** for V1; caching deferred. (resolved)
- V1 checks are **tool-behavior only** — no answer-text oracle in case definitions
  (`answer_contains` and `answer_number` both dropped). Answer / qualitative success is entirely
  a Phase C separate-judge concern. A case may define no checks at all. (resolved)

## Related

`candidates/v1-analysis-and-benchmark-plan.md` (umbrella) · `candidates/benchmark-automation.md`
and `candidates/session-batch-runs.md` (prior, more-autonomous future framing) ·
`research/benchmark-success-criteria.md` (criteria + vocabulary research).
