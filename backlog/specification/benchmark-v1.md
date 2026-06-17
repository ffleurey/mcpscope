# Benchmark v1 (spec in refinement)

Feature 3 of `candidates/v1-analysis-and-benchmark-plan.md`. Being refined toward a
coding-agent-ready task. The success-criteria detail is tracked separately in
`research/benchmark-success-criteria.md` and gates Phase B only.

## Goal / value (UC2)

Let an MCP-server tester (or coding agent) define a test set once and re-run it, so they
focus on their MCP server and get repeated runs as feedback — overall quality and,
specifically, which tools cause issues (descriptions, parameters, performance, token
efficiency). mcpscope owns session/run creation; the tester does not script it.

## Phasing

- **Phase A — run + deterministic stats, NO LLM, NO criteria (the must-have).** Define a
  benchmark, run it, collect per-run metrics, produce an aggregate report. Must prove useful
  on its own.
- **Phase B — deterministic success criteria → per-prompt success rate.** Depends on
  `research/benchmark-success-criteria.md`.
- **Phase C — optional LLM-judged criterion (deferred).** Reuses the skill/guided analysis.

Metrics (A) never depend on criteria (B). A tester gets value from A with zero criteria.

## What already exists vs what is new

Exists (reuse): the `benchmark` container *type* (`executionModel.ts` `CONTAINER_TYPE.BENCHMARK`,
`Benchmark` interface, `parentKindValues` includes `benchmark`, `sessionValidation` allows a
`primary` session to have a `benchmark` parent); the parent-on-create mechanism (analysis
sessions already set `parentKind`/`parentId`); the sequential scheduler; explicit
model/MCP profile selection on create (PR #32); per-part token/tool/error data in persisted
state; trace inspection.

New: there is **no** operation, repository surface, or creation path for benchmark containers
today (the type is unused at runtime). Benchmark v1 adds the container CRUD, the run
orchestration, the deterministic evaluator, and the aggregation report.

## Data model

- **Benchmark definition**: `{ id, name, model_config_id, mcp_profile_ids[], items[] }` where
  each item is `{ id, prompt, repeat: N, expect?: <criteria, Phase B> }`. (Open question:
  store definitions in the JSON config file alongside model/MCP profiles, or a small DB table.
  Lean: JSON config, consistent with current config-in-JSON decision.)
- **Benchmark run (execution)**: creates a benchmark container instance; for each (item ×
  repetition) creates one `primary` session with `parentKind='benchmark'`, the chosen
  profiles, runs the prompt to completion via the scheduler. Runs persist as normal sessions
  under the container — already individually inspectable in the UI.
- **Results**: derived from persisted session state per run; aggregated per item and rolled
  up per tool. (Open question: cache the aggregate, or compute on read. Lean: compute on read
  for V1, it's cheap.)

## Metrics per run (Phase A, from persisted state)

total / prompt / completion / reasoning tokens; tool-call count and per-tool counts; tool
errors (count + which tools); tool rounds; latency; terminal status; final answer text;
`valid_tool_arguments` rate (args validate vs each tool's input schema).

## Aggregate report

- Per item across repetitions: run count, token distribution (min/median/mean/max), tool-call
  frequency per tool, tool-error rate per tool, avg rounds, (Phase B) success rate +
  per-check failure breakdown.
- Cross-item per-tool rollup: how often called, error rate, avg token cost attributable,
  arg-validity rate — the "which tools cause issues" view.

## Surfaces

- **CLI / MCP** (primary for UC2): define/register a benchmark (or pass a benchmark JSON
  file), run a benchmark (returns a run id), poll status, fetch the aggregate report
  (`--json`). Lets a coding agent define once, trigger runs, read structured results.
- **UI**: list benchmarks, view runs, view the aggregate report, drill into individual
  sessions (normal inspectable sessions under the container).

## Out of scope (V1)

- LLM-judged success (Phase C); rich assertion DSL; cross-model/cross-server matrix runs as a
  first-class concept (a tester can define separate benchmarks); concurrency (runs stay
  sequential per the scheduler); regression diffing between two runs (future —
  see `candidates/benchmark-automation.md`).

## Open decisions (need product input)

1. Benchmark definitions in JSON config file vs DB table?
2. Phase B first criteria set — confirm the recommendation in the research note.
3. Numeric/answer extraction approach for `answer_number` (the fuzzy part).
4. Cold vs warm runs — each run = fresh session/context (cold, realistic) assumed; confirm.

## Related

`candidates/v1-analysis-and-benchmark-plan.md` (umbrella), `candidates/benchmark-automation.md`
and `candidates/session-batch-runs.md` (prior, more-autonomous future framing),
`research/benchmark-success-criteria.md` (Phase B gate).
