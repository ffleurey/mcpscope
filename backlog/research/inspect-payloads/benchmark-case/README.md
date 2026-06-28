# inspect: `benchmark_case` (`B-XXXX.N`)

**What it is:** one prompt + optional deterministic tool-behavior checks + optional scored
rubric within a suite
([`BENCHMARK.md:35,71-76`](../../../../BENCHMARK.md);
[`benchmarkOperations.ts:67-81`](../../../../backend/src/operations/benchmarkOperations.ts)).

Example: [`example-B-GUDP.1.md`](example-B-GUDP.1.md).

> **Updated (Phase 1):** renders as **text** (F2). **summary == full is intentional** — a
> case is a **leaf** (like a part): it *is* the full-spec drill target, so there is nothing
> cheaper for a summary to be. Kept as the JSON reference in the refactor.

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

## Tuning notes (Phase 2)

- **Decided (F5): keep summary == full.** A case is a leaf spec — prompt + answer-key
  rubric + tool checks — and that is exactly what every use-case (document/edit a case)
  needs in one fetch. Splitting it would only hide the rubric, the most important field. A
  cheap "list cases" view already exists one level up, in the **`B-` summary** (`{id,
  name}` per case).
