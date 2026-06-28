# inspect: `benchmark` (`B-XXXX`)

**What it is:** the reusable, editable suite blueprint — its metadata, its cases (with
rubrics), and the list of runs spawned from it
([`BENCHMARK.md:27,70`](../../../../BENCHMARK.md);
[`benchmarkOperations.ts:313-324`](../../../../backend/src/operations/benchmarkOperations.ts)).

Example: [`example-B-GUDP.md`](example-B-GUDP.md).

> **Updated (Phase 2):** `B-` now renders as **text** (F2) and has a genuine **summary/full
> split** (F5). Both caveats below are resolved.

## Payload

`{ benchmark, cases[], runs[] }`:

- **Summary** — the cheap router: `cases` are `{id, name}` and `runs` are `{id, status}`.
  Just the nav ids + the signal to pick one.
- **Full** — adds, per case, the `prompt`, `order_index`, and `rubric_criteria_count` (a
  scorability hint, **not** the rubric itself — drill `B-.N`); per run, the completion
  counts (`total/completed/failed_sessions`) and `evaluation_ids`.

Neither mode carries results: inspect the **run** (`R-`) for metrics, the **evaluation**
(`E-`) for scores.

## Use-cases

- **Discover a benchmark's structure** before acting — which cases exist (with IDs
  `B-XXXX.N`) and which runs (`R-XXXX`) have been executed, to pick a case to edit or a
  run to report on. Tool desc: "Inspect a benchmark: its cases and runs"
  ([`MCP.md:39`](../../../../MCP.md)).
- **Agent authoring loop** — an agent collaborating with a developer reads the current
  cases/rubrics before calling `benchmark_add_case` / `benchmark_update_case`
  ([`BENCHMARK.md:136-139`](../../../../BENCHMARK.md)).
- **See run history at a glance** to choose which two runs to compare next.

## Dog-fooding evidence

None — the judge is handed a *session* ID, never the `B-` ID
([`benchmarkEvaluation/evaluationPrompts.ts:27-28`](../../../../backend/src/analysis/benchmarkEvaluation/evaluationPrompts.ts)).
Benchmark-level inspect is for human/authoring agents.

## Decided content target (2026-06-27)

The `B-` payload is for **understanding/monitoring the suite, not for results** — redesigned
(not reproduced) in the refactor (see [`../serialization-architecture.md`](../serialization-architecture.md)):

- **Cases:** enough to see the suite's shape (ids, names/prompts) — **not** the full rubric.
  Inspect the **case** (`B-.N`) for the rubric and full detail.
- **Runs:** **minimal** only — status, completion, whether evaluations exist (to monitor
  progress) — plus the **IDs** of runs and evaluations to inspect.
- **No results in `B-`.** For results inspect the **run** (`R-`); for scores the **evaluation**
  (`E-`). Detail decays with depth: compact children + IDs here; drill for the rest.

## Tuning notes (Phase 2)

- **Resolved:** the redesign above shipped — text rendering (F2) and a real summary/full
  split (F5). The summary skips the per-run progress computation entirely, so it is cheap
  to list a suite's cases and runs.
