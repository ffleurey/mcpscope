# inspect: `session` (`SSS`)

**What it is:** the full runtime trace for one conversation or analysis run — model + MCP
snapshot, context-window usage, the setup, and the ordered list of steps/turns
([`hierarchicalLookup.ts:578-609`](../../../../backend/src/runtime/hierarchicalLookup.ts);
[`DATA-MODEL.md:93-104`](../../../../DATA-MODEL.md)).

Example: [`example-9LJM-session.md`](example-9LJM-session.md).

## Summary mode — use-cases

The summary keeps the header (model, mcp, `context_window.used/available`, compaction
strategy) and lists every child (setup parts, and per turn the round/part IDs with token
counts) **without content**.

- **Map the tree to find child IDs** before drilling — the prescribed first move
  ([`inspect.ts:42-47`](../../../../backend/src/operations/inspect.ts); MCP tool desc:
  "useful for finding child IDs").
- **Budget / compaction questions** — read `context_window.used` vs `available` and
  compare per-turn / per-part token counts, which survive summary mode
  ([`hierarchicalLookup.ts:591-594`](../../../../backend/src/runtime/hierarchicalLookup.ts)).
- **Cheap orientation that respects the agent's own context budget** — "default
  responses should be short summaries; full content should require targeted inspect
  commands" ([`cli-design-for-coding-agents.md:62-69`](../../cli-design-for-coding-agents.md)).

## Full mode — use-cases

Full adds, per round: the `user_prompt`/`assistant_answer` **text**, and every
`tool_call` with size-capped `tool_arguments` (≤80 chars/value, no result).

- **One-shot "what happened" read** — enough to judge tool selection and argument shape
  without per-part drilling.
- **The benchmark judge's primary read** — "Inspecting the session (default, not short)
  returns the user request, the final answer, and each round's tool calls with their
  parameters — enough for most criteria"
  ([`benchmarkEvaluation/systemPrompt.ts:22`](../../../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts)).
- **Ad-hoc iterate loop** — "Inspect the trace. Which tool did the model pick? Were the
  arguments well formed? Did any tool error?" ([`skills/mcpscope/SKILL.md`](../../../../skills/mcpscope/SKILL.md)).

## Dog-fooding evidence

- Analysis **bootstrap** deterministically inspects the target session first
  (`bootstrapInspectIds: [targetSessionId, …]` →
  `{ toolName: 'mcpscope_inspect', toolArgs: { id } }`,
  [`shared/bootstrapStep.ts`](../../../../backend/src/analysis/shared/bootstrapStep.ts)).
- Judge turn prompt: "call mcpscope_inspect with id '…' first (default, not short)"
  ([`benchmarkEvaluation/evaluationPrompts.ts:28`](../../../../backend/src/analysis/benchmarkEvaluation/evaluationPrompts.ts)).

## Tuning notes

- A **full** session inspect is still not "everything": tool schemas show as names only,
  tool results are absent, reasoning text is omitted (see top-level finding #4). The
  payload header doesn't say so — consider a hint pointing to direct part inspection.
- `max_tool_rounds` is in the payload ([`hierarchicalLookup.ts:583`](../../../../backend/src/runtime/hierarchicalLookup.ts))
  but never framed as a "why did this turn stop?" summary read.
