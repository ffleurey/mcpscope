# inspect: `round` (`SSS.W.NT.N`)

**What it is:** one model/tool iteration inside a turn; owns the round's parts
([`DATA-MODEL.md:84,126-131`](../../../../DATA-MODEL.md);
[`hierarchicalLookup.ts:272-290`](../../../../backend/src/runtime/hierarchicalLookup.ts)).

Example: [`example-9LJM-round.md`](example-9LJM-round.md).

## Summary mode — use-cases

- **Enumerate the parts produced in a single model iteration** and their tokens, to
  locate the exact `reasoning`/`tool_call` part to inspect directly. (In the example the
  summary is just two part lines — the leanest container view.)

## Full mode — use-cases

- **Read one iteration in isolation** — the round's reasoning + tool call (capped args) —
  useful when a turn has many rounds and you only care about the one where a retry
  happened.
- **Caveat:** a round full-lookup still uses the *nested* `tool_arguments` form; it does
  **not** expand to the full `{ call, result }` tool payload. For the tool result you
  still inspect the `tool_call` part directly
  ([`hierarchicalLookup.ts:182-208,699-705`](../../../../backend/src/runtime/hierarchicalLookup.ts)).

## Dog-fooding evidence

- Rounds are the unit the analysis planner walks to build evidence packets (one packet
  per tool-call within a round); `round_id` is preserved on every packet and the
  fast-tool prompt requires preserving `round_ids` exactly
  ([`fastTool/systemPrompt.ts:18`](../../../../backend/src/analysis/fastTool/systemPrompt.ts)).

## Tuning notes

- The round is the clearest case where "full" does not mean "full evidence" — the result
  payload is one level deeper. Consider whether a round full-lookup should expand its own
  tool results (it is already a narrow, deliberate request).
