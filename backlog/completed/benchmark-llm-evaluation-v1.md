# Benchmark LLM evaluation (V1)

The missing piece that makes benchmark results *meaningful*: a per-case, tester-defined
**scored rubric**, evaluated by a **separate judge model** that has full session
observability through mcpscope's own inspect surface. Turns the benchmark from "which tools
were called + token counts" into a comparable score that can measure whether an MCP server
(or model) is getting better.

**Implementation stance: reuse the existing analysis subsystem.** This is *not* a new
judging engine — it is a new **`benchmark_evaluation` analysis workflow type** (a single-step
rubric judge) plus a thin benchmark↔analysis seam. The analysis framework already provides
push, pull, structured output, separate-model selection, the read-only endpoint, scheduling,
and persistence (see "Reuse" below).

Builds on shipped Phase A (`completed/benchmark-v1.md`). Grounded in
`research/benchmark-success-criteria.md` and the worked rubrics in
`case-study/prompts/with-evaluation/`. Cross-refs (do not duplicate):
`v1-analysis-and-benchmark-plan.md` (the "skill" analysis mode is the same agentic-inspect
substrate reused here), `benchmark-automation.md`.

## Why (the guiding star)

A benchmark is a **measuring instrument, not a gate**. Unlike a test suite (everything should
pass), we want a score that is *not* maxed out, so there is headroom to detect minor
improvements and differences between runs/models/server versions. Deterministic
tool-behavior checks (Phase A) and token stats are necessary but not sufficient — they don't
tell you whether the answer was *right* or the path was *good*. This adds that, while keeping
runs **comparable** (a fixed-denominator score per case).

## Reuse — what the analysis subsystem already gives us

Verified against the code. We reuse, we do not rebuild:

- **Pull (agentic inspect):** analysis turns already run a *tool-enabled* turn
  (`boundedTurn.ts`, `createToolEnabledTurn(... maxToolRounds: 5)`) against the **read-only**
  `/mcp/analysis` endpoint exposing `mcpscope_inspect` + `status` (`analysisServer.ts`). That
  `maxToolRounds: 5` is exactly our bounded pull budget.
- **Separate judge model + criteria:** `launchAnalysis` already accepts `model_config_id`,
  `temperature`, `additional_instructions`, `system_prompt_override`, `workflow_kind`, and
  `evaluation_criteria` (`launchAnalysis.ts`), building an independent model snapshot.
- **Push:** deterministic inspect injection (`BootstrapStep`) materializes session content into
  the analysis context — reuse the mechanism, change *what* we push (a compact `inspect`
  summary of the target session).
- **Structured output:** Zod schema + `extractJsonBlock` + `safeParse` + diagnostic-on-error,
  with a custom report schema passable to the aggregation step. Define our verdict schema; reuse
  the plumbing.
- **Repeatable, N-per-session, after-the-fact:** a target session can have **many
  `session_analysis` children**; analyses launch independently and run on the scheduler. So
  "evaluate a finished run with judge model M, possibly several times / several models" maps
  directly onto launching analysis children later.
- **Read-only guardrail:** the judge runs against `/mcp/analysis` (inspect+status only) — it
  structurally cannot mutate or pollute the task session. This *is* never-self-judge isolation.
- **Adding a new type is cheap:** subclass `AnalysisSessionBase`, override one hook
  (`onBeforeSession`), add one step, `registerAnalysisWorkflow(...)`. Unused visitor hooks
  don't fire, so a **single-step** judge carries none of the per-tool-call tree-walk overhead.

**Non-goal:** do not refactor the analysis subsystem's known cruft (the over-developed 21-hook
visitor; the deferred `fixme/analysis-dead-cursor-step-key.md`) for this feature. A single-step
type sidesteps the heavy parts. **Monitor during implementation:** if `analysis_v2_cursor`
actually complicates wiring the new type, carry out that cleanup then (and move the fixme to
completed) — otherwise leave it.

## Core model

- A **case** gets an optional **rubric**: an ordered list of **criteria**, each a
  natural-language `description` + a max `points` value. The tester writes them (they already
  do — see `case-study/prompts/with-evaluation/`).
- An **evaluation** = launching the **`benchmark_evaluation` analysis type** on each session a
  run produced (one `session_analysis` child per run-session), with a chosen **judge model**,
  scoring against the run's snapshotted rubric. It is **decoupled, after-the-fact, and
  repeatable** — a run can carry **0..N evaluations** (e.g. different judge models): useful to
  compare models/judges, and a deliberate V1 self-test of our own judging.
- Each per-session judge verdict is a reused **analysis artifact**; the session
  **score = Σ awarded points**, **normalized = Σawarded / Σmax** (a %). Comparability comes
  from the fixed per-case denominator.
- This is **additive to**, not a replacement for, the existing deterministic checks
  (`expectedToolsCalled`/`NotCalled`, no-errors, completed → pass@k/pass^k): the deterministic
  checks are the **zero-variance anchor**; the rubric score is the **graded, sensitive** signal.

### Criteria are natural language, judged over the trace

Deliberately **no predicate DSL**. The whole point: criteria that are objective yet not worth
formalizing — *"3 calls of A, then B reusing the 3 params from A's result"*, *"chose a param
keeping the returned payload under 200 tokens"*, *"answer faithfully reports the value the
tool returned"* — are expressed in prose and checked by the judge against the actual trace.
The judge is a **flexible checker of trace-grounded conditions**, not a taste critic; most
useful criteria are objective and verifiable from evidence, which keeps judge agreement high.

(A future option is to let a criterion opt into a tiny deterministic check type for
zero-variance points — explicitly **out of V1** to avoid the predicate-language rabbit hole.)

## What the judge receives — pull-on-demand (the differentiator, already built)

> **Reconciled to shipped behaviour (F14, 2026-06-28):** the V1 judge is *not* pre-seeded
> with a pushed `short=true` summary. Its prompt names the session id and tells it to
> inspect the session itself **(default, not short)**, then pull deeper only as needed
> (`injectEvidence:false`). The earlier "push the inspect summary" design below was
> superseded; kept for history.

1. **Seed (the id, not a payload):** the judge prompt = the case prompt + the rubric + the
   session id. No trace is inlined. The system prompt: "Inspecting the session (default, not
   short) returns the user request, the final answer, and each round's tool calls with their
   parameters — enough for most criteria"
   ([`systemPrompt.ts:22`](../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts)).
2. **Pull (on demand):** the judge is the existing agentic analysis turn with `mcpscope_inspect`
   over `/mcp/analysis` (bounded to ~5 rounds), so it fetches full payloads/reasoning/any node
   by id when a criterion needs the actual content — or when a criterion tells it to. Same
   inspect logic as push; same bounded-turn substrate as the planned "skill" mode.

Seeding with the `inspect` summary makes exploration the exception, keeping variance and cost
down while preserving full reach. **Both are reused, not new.**

## Judge output — keep it very simple

Lesson from the early analysis sessions: do **not** over-structure this. The new type's verdict
artifact schema is just:

```json
{
  "criteria": [
    { "id": 1, "points": 2, "note": "Reported 7.3°C; matches ha_history_get_state result in ABCD.2W.1T.4-R." },
    { "id": 2, "points": 1, "note": "Resolved sensor but used 2 discovery calls (ABCD.2W.1T.2, ABCD.2W.1T.3), not 1." }
  ],
  "comment": "Correct value; one redundant discovery call."
}
```

- `id` = 1-based index into the rubric criteria; `points` = awarded (0..max — **graded partial
  credit** is the default, so improvements move the score); `note` = one-line evidence;
  `comment` = optional overall one-liner.
- **Notes must cite the hierarchical IDs** (session / turn / part) of the evidence — e.g.
  "redundant discovery call `ABCD.2W.1T.3`". Linking each finding back to an inspectable node is
  core mcpscope value: the tester jumps straight into `inspect` on that ID. Keep the schema a
  plain `note` string with IDs embedded (the UI can linkify them); a structured `refs[]` is a
  possible later addition, not V1.
- Total, normalized %, and aggregation are computed by **mcpscope**, not the judge.
- **Not in the V1 schema** (add later): confidence, categories, severity, verdict enums,
  sub-scores, suggestions.

## Scoring & aggregation (for comparability)

- Per **session**: `score = Σ points`, `pct = Σpoints / Σmax`.
- Per **case** (across the k repetitions): mean pct + distribution (min/median/mean/max/
  stddev). The **spread is the reliability signal**; the mean is the quality signal.
- Per **evaluation**: mean pct across cases. Compare run-vs-run (same judge) to measure
  improvement, or evaluation-vs-evaluation on one run (different judges) to compare/validate
  judges — an uplift is real only if it clears the distribution's noise band.
- Computed at the **benchmark layer** by reading the analysis verdict artifacts; reported
  alongside the existing per-tool rollup and deterministic pass@k/pass^k.

## Data-model additions

- **Case**: `rubric?: { id, description, points }[]` (ordered).
- **Run case snapshot**: include the rubric (runs are immutable snapshots), so an after-the-fact
  evaluation scores against the rubric as it was at run time.
- **Benchmark/Run**: optional `outputGuidance?` (benchmark-level; snapshotted into the run).
- **Evaluation grouping (thin, benchmark-side):** a lightweight record
  `{ id, runId, judgeModelConfigId, status, createdAt, sessions: [{ runSessionId,
  analysisSessionId }], aggregate? }` — mirrors how a run records its `sessions[]`. It is an
  **index over the reused `session_analysis` children**, not a new judging engine. (Lets two
  passes with the same judge model stay distinguishable.)
- **Reused, not added:** the per-session verdict is an **analysis artifact** on the
  `session_analysis` child; the judge model snapshot, scheduling, and the read-only endpoint are
  all existing analysis machinery.
- **New analysis type input/state:** the `benchmark_evaluation` type carries the **rubric
  (criteria + points)** in its workflow input/state — `evaluation_criteria: string[]` can't hold
  points, so add a structured `rubric` field for this type (localized to it).

## Optional: output guidance (secondary, cuts task-output variance)

Optional **benchmark-level `outputGuidance`** (light instruction appended to the prompt/system
prompt, e.g. "answer concisely; return tabular data as a markdown table") reduces run-to-run
*format* variance and makes judging more consistent. Keep it **optional and light** —
over-prescribing format can mask a real weakness in the MCP setup being measured. Cut first if
scope slips.

## Surfaces (CLI/MCP/UI — parity preserved)

- **CLI/MCP**: `benchmark_add_case` accepts a rubric. New **`benchmark_evaluate`** op takes a
  `run_id` + `judge_model_config_id`; for each run-session it launches a `benchmark_evaluation`
  analysis child (reusing `launchAnalysis`), then records the thin evaluation grouping.
  Repeatable. `benchmark_run_report` returns the run's evaluations with per-criterion points and
  per-session/per-case score distributions. Parity stays test-enforced.
- **UI**: rubric editor on the case; an **"Evaluate"** action on a completed run (judge-model
  picker); the run report shows each evaluation's score column + per-criterion breakdown (with
  ID-citing notes that linkify into `inspect`), and lets you compare evaluations side by side.

## Guardrails (non-negotiable, mostly inherited)

- **Separate judge model**, never the task model — the judge runs on `/mcp/analysis`
  (read-only) so it cannot mutate/pollute the task session. Honors never-self-judge.
- **Temperature 0 + structured/JSON output** for reproducibility / fewer format-parse errors.
- **Always surface per-criterion notes** (with cited IDs) for tester calibration.
- Clamp `points` to each criterion's max defensively.
- Evaluation is a **decoupled, optional, repeatable layer**: a run is fully useful with no
  evaluation. Invoked after the fact, as many times as wanted — comparing judges is both a user
  feature and our judge self-test, which is why it's in V1.

## V1 scope

**In:**
- Case rubric (criteria + points), snapshotted into runs.
- A `benchmark_evaluation` **analysis workflow type** (single-step rubric judge) reusing the
  analysis framework (push + pull + structured output + read-only endpoint + scheduler).
- `benchmark_evaluate` op + thin evaluation grouping: launch one analysis child per run-session
  with a chosen judge model; repeatable; multiple evaluations per run.
- Score aggregation (session/case/run, with distributions) in the report; compare evaluations.
- CLI/MCP parity + UI (rubric editor, Evaluate action, scores).
- Optional `outputGuidance` (secondary).

**Out (future):**
- Refactoring analysis-subsystem cruft (21-hook visitor) — only touch `analysis_v2_cursor` if
  it actually complicates the new type (then clean it up).
- Deterministic rubric check types / predicate language; weighted criteria beyond raw points;
  rubric auto-generation.
- Editing a rubric *after* a run and re-scoring (V1 scores the snapshot; the judge model is the
  variable, not the rubric).
- Multi-sample self-consistency / judge ensembles; pairwise/relative judging.
- Answer ground-truth management (the judge verifies against tool results in the trace instead).
- The `guided` / `skill` **session-analysis** modes (separate effort).

## Sequencing

1. New `benchmark_evaluation` analysis type: single step that pushes the `inspect` summary +
   rubric, runs the (already tool-enabled) judge turn, emits the structured verdict artifact.
   Define the verdict schema + system prompt; carry the rubric in the type's input/state; register.
2. Benchmark seam: `case.rubric` + rubric in run snapshot + the thin evaluation grouping record.
3. `benchmark_evaluate` op: per run-session, `launchAnalysis(workflow_kind:'benchmark_evaluation',
   model_config_id: judge, target_turn_id: last, rubric)`; enqueue; record grouping.
4. Aggregation (read verdict artifacts → scores/distributions) + report + UI (Evaluate, scores) + CLI/MCP.
5. (Optional) `outputGuidance`.

The single-step type + seam is the must-have; pull is inherited from the analysis turn, so the
main new code is the type, the rubric transport, the seam, and aggregation.

## Decisions (locked)

- **Reuse the analysis subsystem** as a new single-step `benchmark_evaluation` type; benchmark
  depends on analysis, never the reverse; analysis stays benchmark-agnostic.
- **Rubric transport:** a structured `rubric` (criteria + points) field on the new type's
  input/state (not overloading `evaluation_criteria`).
- **`analysis_v2_cursor`:** leave the cruft alone; clean it up *only if* it complicates this
  work (then move the fixme to completed).
- **Judge model:** allow any model config; hint that small local models make weak judges
  (remote/bigger recommended). No hard restriction.
- **`outputGuidance`:** benchmark-level only for V1.
- **Pull budget:** bounded — reuse the analysis turn's ~5 inspect-round cap; configurable later.

## Sources

Agent/MCP trajectory eval: MCPEval (arxiv 2507.12806), MCP-Bench (2508.20453), LiveMCP-101
(2508.15760). Rubric/structured judging + variance: see `research/benchmark-success-criteria.md`
sources plus "The Necessity of Setting Temperature in LLM-as-a-Judge" (arxiv 2603.28304),
Monte Carlo "LLM-as-judge best practices", Galileo "agent evaluation framework".
