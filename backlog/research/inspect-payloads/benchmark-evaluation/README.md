# inspect: `benchmark_evaluation` (`E-XXXX`)

**What it is:** one LLM-judging pass over a completed run with a chosen judge model — a
thin grouping record linking each run-session to the `benchmark_evaluation` analysis
session that judged it. Scores are **not stored**; they are computed on read from the
judge verdict artifacts
([`BENCHMARK.md:38,84-89,330-345`](../../../../BENCHMARK.md);
[`benchmarkOperations.ts:336-348,101-131`](../../../../backend/src/operations/benchmarkOperations.ts)).

Examples (captured from completed run `R-RZNP`, which carried two evaluation passes):
- [`example-E-FE7K-complete.md`](example-E-FE7K-complete.md) — **complete** pass, judge
  `kimi-k25`, overall 50%, 22/22 judged.
- [`example-E-2BPM-error.md`](example-E-2BPM-error.md) — **errored / incomplete** pass,
  judge Gemma, overall 58.5%, only 20/22 judged (2 judge sessions returned invalid JSON).

These two passes over the **same run** with **different judge models** are the canonical
material for the compare/audit use-cases ([`../use-cases.md`](../use-cases.md) UC-5/UC-7).

> ⚠️ **JSON-only** (no CLI text renderer). And, confirmed empirically: inspect **always
> attaches the full scored report** regardless of `mode` — the summary and full payloads
> are **byte-identical except the echoed `"mode"` field**, so summary is *not* lighter for
> `E-` ([`benchmarkOperations.ts:336-348`](../../../../backend/src/operations/benchmarkOperations.ts)).
> This is the opposite of `R-`'s cheap-summary design — a candidate inconsistency.

## Payload (both modes)

`{ evaluation }`: `judge_model_config_id`, `judge_temperature`, `status`, `error`,
`expected_sessions` / `judged_sessions`, and
`score{ overall_pct, cases[{ pct_stats, sessions[{ analysis_session_id, awarded, max,
pct, criteria[{id,description,max,points,note}] }] }] }`.

## Summary-mode use-cases

- **Compare judge models / passes on one run** — a run can carry 0..N evaluations; read
  each pass's `overall_pct` + `judge_model_config_id` / `judge_temperature` to compare
  judges or probe judge stability ([`BENCHMARK.md:84,326-328`](../../../../BENCHMARK.md)).
- **Completeness check** — `judged_sessions` vs `expected_sessions` tells you a pass is
  incomplete (failed/orphaned judges) and needs a Retry rather than appearing done
  ([`BENCHMARK.md:361-364`](../../../../BENCHMARK.md)).
- **Run-vs-run quality comparison (same judge)** — compare `overall_pct` across passes,
  but only believe an uplift that clears the distribution's noise band
  ([`benchmark-llm-evaluation-v1.md:139-141`](../../completed/benchmark-llm-evaluation-v1.md)).

## Full-mode use-cases

- **Detailed scoring grid** — the per-criterion breakdown
  `criteria[{id, description, max, points, note}]` is the rubric joined with the judge's
  awarded points + an ID-citing note, so the UI/CLI can show the grid, not just the total
  ([`BENCHMARK.md:336-341`](../../../../BENCHMARK.md)). Plus per-case `pct_stats` spread.
- **Jump-off to judge reasoning** — each per-session entry carries the
  `analysis_session_id` of the judge session: inspect `E-` → get `analysis_session_id` →
  inspect that session → read the verdict (it cites the exact session/turn IDs it scored)
  ([`BENCHMARK.md:408-409`](../../../../BENCHMARK.md)).

## Dog-fooding evidence

This is where inspect is dog-fooded most directly. The judge **is** a
`benchmark_evaluation` analysis session, handed only the session-under-test ID (never the
`E-`/run/case ID) via the restricted `/mcp/analysis` endpoint exposing only
`mcpscope_inspect` + `mcpscope_status`
([`benchmarkEvaluationAnalysis.ts:77-91`](../../../../backend/src/analysis/benchmarkEvaluation/benchmarkEvaluationAnalysis.ts);
[`MCP.md:244-265`](../../../../MCP.md)).

Key instructions:
- "Inspecting the session (default, not short) returns the user request, the final
  answer, and each round's tool calls with their parameters — enough for most criteria.
  Fetch a specific turn or part only when a tool-use criterion needs a detail the session
  view omits" ([`systemPrompt.ts:22`](../../../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts)).
- "Be economical… Never inspect to 'confirm' an answer value the rubric already pins"
  ([`systemPrompt.ts:23`](../../../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts)).
- "In every note, cite the hierarchical IDs of the evidence you used (session / turn /
  part), so the tester can inspect them"
  ([`systemPrompt.ts:31`](../../../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts)).
- `injectEvidence:false` — the judge pulls on demand, dog-fooding the same inspect
  surface a human tester uses (matches the MEMORY note "judge trusts rubric as oracle,
  given session ID with no pasted content").

## Decided content target (2026-06-27) — redesigned, not reproduced

Focus on **status + scores + a drillable session list**. See
[`../serialization-architecture.md`](../serialization-architecture.md).

- **Summary:** status + completeness (`judged/expected`, with an explicit **incomplete flag**
  — F11), `overall_pct`, and **every judged session with {analysis_session_id, status, pct}**
  for drill-down to the judge's reasoning.
- **Full:** adds per-case distribution and the per-criterion grid (or leave the grid to the
  judge `analysis_session_id` drill — settle when building `E-`). Makes summary genuinely lean
  (F5) and incompleteness visible (F11).

## Tuning notes

- **Doc/code drift:** [`benchmark-llm-evaluation-v1.md`](../../completed/benchmark-llm-evaluation-v1.md)
  says the judge seeds from `short=true`; the shipped prompt says "default, not short" (F14).
- Redesign above retires the F2 (no text) and F5 (summary not cheaper) gaps for this type.
