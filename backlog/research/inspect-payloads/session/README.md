# inspect: `session` (`SSS`)

**What it is:** the full runtime trace for one conversation or analysis run — model + MCP
snapshot, context-window usage, the setup, and the ordered list of steps/turns
([`hierarchicalLookup.ts:578-609`](../../../../backend/src/runtime/hierarchicalLookup.ts);
[`DATA-MODEL.md:93-104`](../../../../DATA-MODEL.md)).

Examples: [`example-9LJM-session.md`](example-9LJM-session.md) (single-turn primary) ·
[`example-2ZHT-multiturn-clean.md`](example-2ZHT-multiturn-clean.md) (clean 2-turn primary) ·
[`example-RH8P-multiturn.md`](example-RH8P-multiturn.md) (multi-turn, mid-stream error) ·
[`example-ZTJE-analysis-session.md`](example-ZTJE-analysis-session.md) (analysis/judge session,
steps own turns).

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

## Tuning notes (Phase 2)

- **Resolved — uniform "how did this end and why" (F9/F10).** Every session payload now
  carries a top-level **`terminal_status`** (rendered as `status` in the header), derived
  the same way for primary, analysis, and judge sessions (it agrees with the run report's
  per-session `terminal_status`). When it is `error`, the header also shows the failure
  reason: an analysis diagnostic, a persisted init failure, or — for a primary session —
  the trailing `diagnostic` part's stop reason. A failure is now visible from the header
  without reading the whole trace (see [`../errors/`](../errors/)).
- **Resolved — graph-plumbing trimmed (F4).** `token_source`/`token_confidence` (per part)
  and `owner_step_id` (per turn) were dropped from the payload — no use-case read them. The
  `parent_ref` edge is now **rendered** (`parent <kind> <id>`), surfacing the run/analyzed
  -session link for the audit chain.
- **Structure (content pass):** the JSON groups all header/identity metadata
  (`model`, `mcp`, `parent_ref`, `terminal_status`, failure) **before** the body (`setup` +
  `steps`), instead of trailing `parent_ref`/`mcp` after the big `steps` array — the JSON now
  reads like the text header. Each turn renders a **header line** (rounds + token cost) in the
  session view, delimiting turns the way a step header delimits a compaction step. Children
  (turns + steps) are ordered by **creation time**, so a mid-session compaction reads
  *between* the turns it sat between (the old id-suffix sort placed it after the next turn).
- **Found by broader testing (multi-model, multi-turn, analysis sessions):**
  - **Analysis/judge sessions now render their owned turns.** An analysis step (e.g.
    `analysis_benchmark_evaluation`) owns a turn with the agent/judge's rounds, tool calls,
    and final answer; the text used to show only the step header, hiding the entire trace.
    It now renders — the "audit the judge" path (UC-7) works in text. See
    [`example-ZTJE-analysis-session.md`](example-ZTJE-analysis-session.md).
  - **An errored turn always yields a header reason.** A turn can fail mid-stream (provider/
    tool error) with no diagnostic part; the session now synthesizes the failure summary from
    the errored turn (`<outcome>: Turn N ended in error`) and the turn line shows its
    `outcome` inline, so `status:error` is never shown bare. See
    [`example-RH8P-multiturn.md`](example-RH8P-multiturn.md).
- **Still by design:** a full session inspect inlines neither tool schemas nor tool results
  (the router stays cheap); the part **IDs + token weight** are the drill signal and
  `tool_definitions` now shows its **tool count** (F6). Drill the `-TD`/`-T` part for the
  full schema/result.
