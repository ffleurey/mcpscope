# inspect: `benchmark` (`B-XXXX`)

**What it is:** the reusable, editable suite blueprint — its metadata, its cases (with
rubrics), and the list of runs spawned from it
([`BENCHMARK.md:27,70`](../../../../BENCHMARK.md);
[`benchmarkOperations.ts:313-324`](../../../../backend/src/operations/benchmarkOperations.ts)).

Example: [`example-B-GUDP.md`](example-B-GUDP.md).

> ⚠️ Two caveats up front (see top-level findings #2 and #3): the CLI has **no text
> renderer** for `B-` — it dumps JSON. And **summary and full are identical** —
> `resolveBenchmarkInspect` ignores `mode` for benchmarks
> ([`benchmarkOperations.ts:307-325`](../../../../backend/src/operations/benchmarkOperations.ts)).

## Payload (both modes)

`{ benchmark, cases[], runs[] }` — `benchmark` is id/name/description/timestamps; `cases`
are the **full** case shape incl. prompt, tool checks, and `rubric`; `runs` are full run
snapshots.

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

## Tuning notes

- Today **summary == full** and there's **no text rendering** — both subsumed by the redesign
  above and tracked as F2/F5 in [`../FINDINGS.md`](../FINDINGS.md).
