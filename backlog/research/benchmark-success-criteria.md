# Research: benchmark success criteria

The hard, open part of `specification/benchmark-v1.md`. How do we define a **simple**
success signal for a prompt run — useful to an MCP-server tester, robust to LLM
non-determinism, and (for V1) evaluable deterministically **without an LLM judge**?

## Principles

- **Success is a rate, not a verdict.** Across N repetitions of the same prompt, report a
  success rate (e.g. 7/10) plus variance. This is the natural way to handle non-determinism
  and is more informative than a single pass/fail.
- **Separate metrics from criteria.** Metrics (tokens, tool calls, tool errors, rounds,
  latency, per-tool stats) are *always* collected and reported regardless of criteria.
  Criteria are opt-in pass/fail checks layered on top. Phase A (metrics) must not depend on
  criteria.
- **Prefer objective, tool-behavior checks over answer-text checks.** Tool-behavior checks
  ("did it call `get_statistics`", "did any tool error") isolate *server quality* from
  *model phrasing* — which is what the tester actually cares about. Answer-text checks are
  phrasing-brittle and conflate the two.
- **Per-check failure breakdown is a first-class output.** Knowing *which* check fails, and
  how often, is the tool-quality signal (e.g. "failed to call `get_statistics` in 4/10 runs"
  → tool description problem; "tool errored in 3/10" → tool reliability/param problem).
- **Small, composable, forward-compatible.** A criterion is a list of typed checks, all of
  which must pass (AND). The typed-union shape leaves room to add a `judge` (LLM) check type
  later (Phase C) without reshaping.

## Candidate check types (ranked by objectivity)

1. `tools_called`: set of tool names each called ≥ once. Fully objective. Central.
2. `no_tool_errors`: no tool call returned an error result. Fully objective. Strong server signal.
3. `tools_not_called`: named tools must NOT be called. Fully objective negative guard.
4. `completed`: a final answer was produced (did not hit the tool-round limit or bail).
   Fully objective baseline.
5. `answer_contains`: substring or regex match on the final answer, normalized
   (lowercase/whitespace). Semi-objective; phrasing-brittle; weak signal.
6. `answer_number`: extract a number from the final answer and check against an expected
   value ± tolerance (absolute or pct). Good for quantitative prompts (e.g. the home-assistant
   statistics use case). Fuzzy extraction (see below).

Plus `valid_tool_arguments` (do the model's emitted tool-call arguments validate against the
tool's input schema?) — recommend collecting as a **metric** first (it directly measures
whether a tool's parameter design is usable by the model), promote to a criterion later.

## The genuinely fuzzy bits (the research)

- **What is "the answer"?** Define as the final assistant content part of the session.
  Structurally trivial given the data model; the difficulty is meaning, not location.
- **Numeric extraction from prose.** Units, thousands separators, multiple numbers, ranges.
  Pragmatic V1 default: regex all numbers in the answer, normalize, and pass if *any* is
  within tolerance of the expected value; record the extracted set and flag ambiguity
  (>1 candidate) in the report rather than silently guessing.
- **`answer_contains` brittleness.** Mitigate with normalization + optional regex; otherwise
  accept it as a weak signal and steer testers toward tool-behavior checks.
- **AND vs weighting.** V1: AND (all specified checks must pass for a run to count as success),
  for simplicity. But report per-check pass rate so partial signal is visible even when the
  overall run fails.

## Recommendation for the first criteria iteration (Phase B)

- Check types: `tools_called`, `no_tool_errors`, `tools_not_called`, `completed`,
  `answer_contains`, `answer_number`.
- `valid_tool_arguments` as a metric (Phase A), criterion candidate later.
- Success = all specified checks pass; report per-prompt success rate over repetitions and a
  per-check failure breakdown.
- Defer the LLM-judge check to Phase C (reuses the skill/guided analysis); keep the check
  list a typed union so it slots in without a schema change.

## Open questions

- Numeric extraction: is "any number within tolerance passes" good enough, or do we need an
  anchored extraction (e.g. "the number nearest a keyword")? Start simple, revisit with real
  traces.
- Do we ever need ordering/sequence checks on tool calls (A before B), or is set-membership
  enough for V1? Lean: set-membership only.
- Should `answer_contains` support an OR-of-alternatives ("contains any of [...]")? Likely
  yes, cheap, and reduces brittleness.
