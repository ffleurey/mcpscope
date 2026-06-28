# inspect: `benchmark_run` (`R-XXXX`)

**What it is:** an immutable snapshot of the cases + model/MCP/repetition settings that
were executed, plus the produced sessions; inspectable like a session and shown as a
container in the tree
([`BENCHMARK.md:29-30,52-57,77-83`](../../../../BENCHMARK.md)).

Example: [`example-R-RZNP.md`](example-R-RZNP.md).

> ⚠️ **JSON-only** (no CLI text renderer). But unlike `B-`/`B-.N`, the summary/full dial
> **is real here** — full adds the compute-on-read metrics report
> ([`benchmarkOperations.ts:326-334`](../../../../backend/src/operations/benchmarkOperations.ts)).
> This is the cleanest, most meaningful summary/full split among the four benchmark types.

## Summary mode — use-cases

Summary = `{ run }` only: the config snapshot (cases-with-rubric, sessions with
per-session status, model_config_id, mcp_profile_ids, repetitions, max_tool_rounds,
timestamps).

- **Cross-run comparison / run-to-run report** (the task's headline example) — summary
  carries exactly the *configuration* axis you diff across runs: model, MCP profiles,
  cases, repetitions ("run the same cases against different model/MCP combinations",
  [`BENCHMARK.md:94-96`](../../../../BENCHMARK.md)). Lightweight, no session traces loaded.
- **Cheap progress / identity checks** — terminal `status` + per-session `status` without
  paying for the heavy report (the report loads session traces,
  [`BENCHMARK.md:240-242`](../../../../BENCHMARK.md)).
- **Audit what a past run was scored against** — the run snapshots the case rubric "so you
  can always see exactly what a past run was scored against"
  ([`BENCHMARK.md:343-345`](../../../../BENCHMARK.md)).
- **Navigate to child sessions** — grab `session_id`s to drill into the tree.

## Full mode — use-cases

Full = `{ run, report }`, adding per-tool rollup + per-case pass@k/pass^k/token stats +
per-session metrics.

- **Detailed single-run report** (the task's headline example) — the per-tool "which
  tools cause issues" scorecard (`calls`, `errors`, `error_rate`, `result_payload_chars`)
  and per-case `success_rate`, `pass_at_k`, `pass_hat_k`, token distributions
  ([`BENCHMARK.md:246-264`](../../../../BENCHMARK.md)).
- **Diagnose a flaky MCP tool** — high `error_rate` / oversized `result_payload_chars`
  points at a tool whose description/params need work
  ([`BENCHMARK.md:395-398`](../../../../BENCHMARK.md)).
- **Diagnose non-determinism** — the gap between `pass_at_k` and `pass_hat_k`, and token
  stddev, are the reliability signals.
- **Per-session forensics** — `report.cases[].sessions[]` gives `terminal_status`,
  `final_answer`, `tool_error_count`, per-tool counts, and an `error` summary per
  repetition.

## Dog-fooding evidence

The judge does not inspect the run ID, but the run report is a downstream dog-fooding
consumer: verdict notes cite hierarchical session/turn/tool-call IDs so "a finding always
points back at the exact session/turn/tool-call it refers to"
([`BENCHMARK.md:56-58`](../../../../BENCHMARK.md)) — a tester "jumps straight into
`inspect` on that ID".

## Decided content target (2026-06-27) — redesigned, not reproduced

Focus on **status + evaluation results + a drillable session list** (GUI `RunReportView` is
the relevance reference). See [`../serialization-architecture.md`](../serialization-architecture.md).

- **Summary:** run status + completion; the evaluation passes present (id, status, overall) to
  monitor progress; and **every session with {id, status}** for drill-down.
- **Full:** adds the per-session metrics that help decide *which* session to drill — total
  context used (`tokens.total`), `tool_call_count`, `tool_error_count`, `terminal_status`,
  `final_answer`/`error` — plus per-case pass rates and the per-tool rollup. These already
  exist in `SessionMetrics`; the work is **restructuring toward a flat session-centric list**,
  not new computation.

## Tuning notes

- **No text rendering** today (F2) and a deep per-case→per-session nesting — both addressed by
  the redesign above. Tracked as F2/F12 in [`../FINDINGS.md`](../FINDINGS.md).
