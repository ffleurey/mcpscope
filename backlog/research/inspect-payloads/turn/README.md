# inspect: `turn` (`SSS.NT`)

**What it is:** one full user-request → model-response lifecycle; the LLM-specific step
subtype, owning the rounds
([`DATA-MODEL.md:85,117-124`](../../../../DATA-MODEL.md);
[`hierarchicalLookup.ts:292-319`](../../../../backend/src/runtime/hierarchicalLookup.ts)).

Example: [`example-9LJM-turn.md`](example-9LJM-turn.md).

## Summary mode — use-cases

- **Map the turn's rounds and part IDs**, and read merged per-`tool_call` token counts,
  to decide which round/part is worth a full read. (A `tool_call`'s `token_count` is the
  *merged* call+result total — [`hierarchicalLookup.ts:91-98`](../../../../backend/src/runtime/hierarchicalLookup.ts).)
- **Compare token cost** of one turn vs another without content.

## Full mode — use-cases

- **Read everything in one turn** in one shot: `user_prompt`/`assistant_answer` text plus
  every `tool_call`'s capped `tool_arguments` across all rounds — the standard "what
  happened this turn" read ([`CLI.md`](../../../../CLI.md);
  [`TUTORIAL.md`](../../../../TUTORIAL.md) "inspect the turn, tool calls, and setup").
- The judge fetches a specific turn "only when a tool-use criterion needs a detail the
  session view omits"
  ([`benchmarkEvaluation/systemPrompt.ts:22`](../../../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts)).

## Dog-fooding evidence

- The deterministic analysis workflow is **turn-scoped**: `TurnSummaryStep` produces one
  `turn_summary` artifact per analyzed turn
  ([`shared/turnSummaryStep.ts`](../../../../backend/src/analysis/shared/turnSummaryStep.ts)),
  implementing "synthesize one turn summary per analyzed turn"
  ([`completed/SESSION-ANALYSIS.md`](../../completed/SESSION-ANALYSIS.md)).

## Tuning notes (Phase 2)

- **Content pass:** the turn now carries a **`tokens`** summary (prompt/completion/reasoning/
  total, from the turn's own usage) and renders a **header line** (`<id> turn <status> N rounds
  (T tokens)`) — so "how costly / how many rounds was this turn?" is answerable from the
  header, and a turn reads like a step in the session view. `owner_step_id` was dropped
  (graph-plumbing, no use-case, F4). A turn that did **not** end cleanly also carries its
  `outcome` (e.g. `step-error`), rendered inline on the header — the one persisted clue when a
  turn fails mid-stream with no diagnostic part.
- **By design:** a full-turn overview keeps tool payloads capped/result-free so the turn
  stays a cheap router; the full result is one drill away (the `tool_call` part, or — for a
  single iteration — the **round** full-lookup, which expands it, F7).
