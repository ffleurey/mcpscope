# inspect: `part` (`SSS.W.NT.N.N-X`)

**What it is:** one committed semantic content node inside setup or a round
([`DATA-MODEL.md:87,133-144`](../../../../DATA-MODEL.md)). This is the **leaf evidence**
level — "Direct part inspection is how you read exact tool payloads/results and full part
content" ([`inspect.ts:45`](../../../../backend/src/operations/inspect.ts)).

Examples (one per subtype):
[`mcp_instructions`](example-mcp_instructions.md) ·
[`tool_definitions`](example-tool_definitions.md) ·
[`user_prompt`](example-user_prompt.md) ·
[`reasoning`](example-reasoning.md) ·
[`tool_call` (+ folded `tool_result`)](example-tool_call.md) ·
[`assistant_answer`](example-assistant_answer.md) ·
[`diagnostic`](example-diagnostic.md).

## The key fact: parts are always full

A direct part lookup is **hard-coded to `full`** — `--short`/`short:true` is silently
ignored ([`hierarchicalLookup.ts:732`](../../../../backend/src/runtime/hierarchicalLookup.ts)).
The summary/full dial does not apply to parts. The meaningful axis is instead:

- **Part as seen inside a container overview** — abbreviated: tool defs → names only;
  tool calls → `tool_arguments` capped at 80 chars/value, no result; reasoning → omitted.
- **Part inspected directly** — the full untruncated payload.

So you reach for direct part inspection precisely when the container overview abbreviated
away the thing you need.

## Per-subtype use-cases

| Subtype | When you inspect it directly |
|---|---|
| `mcp_instructions` (`-MI`) | Read the exact server instruction block the model was given — judge whether tool misuse was the server's fault. |
| `tool_definitions` (`-TD`) | The **only** way to get the full JSON tool schemas (every other view is names-only). Evaluate "was the tool description specific enough?" |
| `user_prompt` (`-U`) | Confirm exactly what was asked. (Content is already inlined in overviews, so rarely needed standalone.) |
| `reasoning` (`-R`) | Read the model's reasoning before/after a tool call — "why this tool?". Reasoning is **not** inlined in overviews, and is stripped from later context by compaction, so the part is where it survives. |
| `tool_call` (`-T`) | The full `{ call, result }` payload — exact result values, row counts, and long/truncated argument values. The `tool_result` is folded into this node ([`hierarchicalLookup.ts:721-730`](../../../../backend/src/runtime/hierarchicalLookup.ts)); inspecting a `tool-result` ID redirects here. |
| `assistant_answer` (`-A`) | Verify the final answer — but "do not claim success just because the final assistant answer looked plausible" ([`agent-skill-patterns-for-mcpscope.md`](../../agent-skill-patterns-for-mcpscope.md)). |
| `diagnostic` (`-DN`) | The stop reason when a turn fails (e.g. "reached the maximum of 20 tool-call rounds without a final assistant response"). Appears only in failed traces; `context_state: excluded`, `token_count: null`. The canonical "why did this session fail" payload — see [`../errors/`](../errors/). |

## Dog-fooding evidence

- The analysis assessment step deterministically inspects each `(reasoning_before,
  tool_call, reasoning_after)` slice as one bounded evidence packet
  ([`shared/toolCallAssessmentStep.ts:74-88`](../../../../backend/src/analysis/shared/toolCallAssessmentStep.ts)),
  realizing "read the full reasoning before the tool call and the tool call itself as
  well as the reasoning after" ([`agent-harnessing.md`](../../agent-harnessing.md)).
- The judge: "Fetch a specific … part only when a tool-use criterion needs … a tool
  result's values or row count, or a parameter value long enough to be truncated"
  ([`benchmarkEvaluation/systemPrompt.ts:22`](../../../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts)).
- `tool_call_part_id` must be preserved exactly in analysis output
  ([`fullSession/systemPrompt.ts:23,27`](../../../../backend/src/analysis/fullSession/systemPrompt.ts)).

## Tuning notes (Phase 2)

- **F4 trimmed the part node:** `token_source`/`token_confidence` were removed (no use-case
  read them); `token_count` and `context_state` remain. `diagnostic` content (the stop
  reason) now also surfaces at the **session header** as the failure summary, so triage no
  longer requires reading to the trailing `-DN` part — though it stays the canonical leaf.
- Because `--short` is a no-op on parts, exposing a part's `short` flag in the tool
  contract is arguably misleading — the operation docstring already carves out the
  exception ("Parts always return full content regardless"), but the dial still appears
  in the schema. Decide whether to keep it documented-but-inert or signal it. *(Open.)*
- The folding of `tool_result` into `tool_call` is good for the tree but means there is
  no first-class `tool_result` example to inspect — captured here inside the `tool_call`
  example.
