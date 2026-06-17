# Refactor: decompose createToolEnabledTurn

Tier-3 runtime refactor deferred from the 2026-06-17 foundation cleanup (the Tier-1/2
cleanups landed on branch `cleanup/v1-foundation`). Not urgent; do when the runtime is
being touched anyway, and only after adding the missing test below.

## Finding

`backend/src/runtime/toolTurns.ts` `createToolEnabledTurn` (~790 lines) is a god-function
doing five things in one body: session/turn/round init, the round loop, a ~270-line
tool-call branch, a ~170-line final-response branch, and a separate ~100-line
tool-loop-limit error path. Nesting reaches ~5 levels. The duplicated segment->parts logic
was already extracted into `turnAssembly.ts` (PR on the cleanup branch), which removed the
worst duplication, but the function is still the dominant complexity hotspot in the runtime.

## Proposed work

Decompose into `runToolRound()` (returns `{toolCalls, parts, nextMessages, pendingSuffix}`),
`finalizeResponseRound()`, and `emitToolLoopLimitError()`. Leave
`applyPendingPromptSuffixAttribution` (~270 lines) alone — it is essential, intricate,
well-commented token-attribution logic, not accidental complexity.

## Risk / prerequisite

Medium risk: the loop carries mutable state (`requestMessages`, `currentRound`,
`pendingPromptSuffix`). **The tool-loop-limit branch (~toolTurns.ts 2211-2314) has no test
coverage** — `maxToolRounds` is always set generously and never exhausted in tests. Write a
`maxToolRounds`-exhaustion test FIRST, then decompose. Existing coverage (toolTurns.test.ts
multi-tool/segmented-reasoning cases, replayHarness compaction case) protects the rest.
