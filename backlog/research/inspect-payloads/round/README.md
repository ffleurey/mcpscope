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

- **Read one iteration in isolation** — the round's reasoning + tool call **with the full
  `{ call, result }` payload** — useful when a turn has many rounds and you only care about
  the one where a retry happened. A round is a deliberate, narrow request, so its full
  lookup expands the tool result (F7 — it no longer forces a second `tool_call` part
  drill). Inside a session/turn *overview*, the same round still shows the compact,
  capped `tool_arguments` form.

## Dog-fooding evidence

- Rounds are the unit the analysis planner walks to build evidence packets (one packet
  per tool-call within a round); `round_id` is preserved on every packet and the
  fast-tool prompt requires preserving `round_ids` exactly
  ([`fastTool/systemPrompt.ts:18`](../../../../backend/src/analysis/fastTool/systemPrompt.ts)).

## Tuning notes (Phase 2)

- **Resolved (F7):** a round full-lookup now expands its own tool results, so "full" means
  "full evidence" for the one iteration. (It already did in the shipped code; the doc note
  was stale.)
