# inspect: `benchmark_case` (`B-XXXX.N`)

**What it is:** one prompt + optional deterministic tool-behavior checks + optional scored
rubric within a suite
([`BENCHMARK.md:35,71-76`](../../../../BENCHMARK.md);
[`benchmarkOperations.ts:67-81`](../../../../backend/src/operations/benchmarkOperations.ts)).

Example: [`example-B-GUDP.1.md`](example-B-GUDP.1.md).

> ⚠️ Same two caveats as `benchmark`: **JSON-only** (no CLI text renderer) and
> **summary == full** (mode ignored, [`benchmarkOperations.ts:309-311`](../../../../backend/src/operations/benchmarkOperations.ts)).

## Payload (both modes)

id, benchmark_id, name, prompt, order_index, `expected_tools_called`,
`expected_tools_not_called`, `rubric[{id,description,points}]`, `source_session_id`,
timestamps.

## Use-cases

- **Read a single case's exact prompt and current rubric/checks before editing it** — the
  rubric is "the answer key — author it as one"; reviewing it *is* the authoring task
  ([`BENCHMARK.md:303-313`](../../../../BENCHMARK.md)).
- **Trace provenance** — `source_session_id` tells you which session a "from-session"
  case was extracted from, so you can jump back to refine the prompt.
- **Confirm LLM-scorability** — an empty `rubric` means the case is not LLM-scored
  ([`BENCHMARK.md:36-37`](../../../../BENCHMARK.md)).

## Dog-fooding evidence

None directly on the `B-X.N` ID. The judge receives the rubric criteria *inlined into its
turn prompt* ([`evaluationPrompts.ts:15-16,30`](../../../../backend/src/analysis/benchmarkEvaluation/evaluationPrompts.ts)),
not by inspecting the case — the rubric is snapshotted onto the run/evaluation.

## Tuning notes

- **Summary == full**, and the payload is small and complete, so there is nothing for a
  full mode to add. If we want a meaningful split, summary could be prompt+name+points-total
  and full could add the per-criterion rubric and tool checks.
