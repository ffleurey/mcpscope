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

## Tuning notes

- As with sessions, full-turn tool payloads are capped/result-free; the full result still
  requires a direct `tool_call` part lookup (top-level finding #4).
