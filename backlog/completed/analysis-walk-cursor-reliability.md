# Analysis workflow: walk cursor & retry reliability

## Summary

The analysis session framework uses a linear walk cursor over a flattened hook
list to drive multi-step workflows. The cursor is a fragile implicit pointer —
it has no correlation to the actual semantic unit of work being performed.

This task is about redesigning the cursor mechanism. Quick fixes have been
applied for surface-level bugs; the architectural problem remains.

## The architectural problem

Analysis sessions flatten the target session tree into a linear list of hook
calls (`beforeSession`, `onToolCall`, `afterTurn`, `afterSession`, etc.) and
walk through them one at a time. The `walkCursor` — a bare integer index into
this list — is the only mechanism for tracking progress.

**A linear index has no semantic meaning.** It cannot answer:
- Which packet is being assessed?
- Which turn is being summarized?
- Should the walk regress when the tree changes?

The cursor's opacity creates three categories of failure:

### 1. No causal link between cursor position and work done

When a hook creates a `WorkflowStep` and the step fails, the cursor has already
advanced past the hook. Retry requires resetting the cursor to 0 and replaying
every hook from the start, relying on ad-hoc guard conditions
(`bootstrapComplete`, `nextPacketIndex` range checks, `finalAggregationComplete`)
to prevent re-execution. This is fragile — a missing guard causes duplicate
work or inconsistent state.

### 2. No mechanism to regress when the tree grows

The hook list is rebuilt on every `resumeOneStep()` call by reloading the
target session from the database. If new turns were added to the target
session between calls, the flattened list contains more positions. But the
walk cursor is an absolute index into the PREVIOUS list — it doesn't regress
to include the new positions, even though the new turns are now visible in
the rebuilt tree.

The existing test at `backend/src/analysis/analysisSessionTree.test.ts`
documents this limitation:
```
expect(false).toBe(true) // known limitation — targetTurnId is fixed
```
(once the cursor mechanism is redesigned, this assertion should change to
 verify that new-turn hooks are visited after `resumeOneStep()`)

### 3. No semantic position for retry

`resetFailedAnalysisStepForRetry` currently resets `walkCursor` to 0 (a
full re-walk) because there is no way to regress to the exact failing
hook. A semantic cursor — `{ phase: 'assessing', packetIndex: 3 }` or
`{ phase: 'turn_summary', turnId: '...' }` — would allow precise retry
without replaying the entire workflow.

## Key design considerations

### Semantic position instead of linear index

The cursor should reference the conceptual unit of work, not a flat position:
- Assessment: `{ kind: 'assess', packetIndex: 3 }`
- Turn summary: `{ kind: 'turn_summary', turnId: '...' }`
- Final aggregation: `{ kind: 'final_aggregation' }`

This makes retry a direct index regression with no full re-walk, and makes
tree growth detection natural — if `packetIndex < packetCount` after a
rebuild, there is new work.

### Hook idempotency contracts

Every hook should either be fully guarded (early-return on re-execution) or
explicitly checkpointed. The current guard pattern
(`bootstrapComplete`, `nextPacketIndex`, `finalAggregationComplete`) is
inconsistent — some hooks (like `afterSession`) lack error-phase guards,
causing them to create new steps even when the analysis should stop.

### Session-level transaction for retry

`resetFailedAnalysisStepForRetry` currently excludes parts from the failed
turn but does not reset the step record or re-initialize assessment state.
A transaction that atomically resets artifacts, step records, parts, and
the analysis state would eliminate dangling state.

## Failing test

**`backend/src/analysis/analysisSessionTree.test.ts`** — verifies that turns
added to the target session after the analysis starts are not included in
the flattened hook list because `targetTurnId` is fixed at bootstrap.

To make this test pass (once the cursor is redesigned):
```typescript
const state = JSON.parse(db.connection.prepare(
  "SELECT analysis_state_json FROM v2_sessions WHERE id='ANLY'"
).pluck().get() as string)
expect(state.targetTurnId).toContain('TARG.2T')
```

## Quick fixes already applied (not the architectural solution)

These fix surface-level bugs but do not address the linear-cursor problem.
Listed for reference — they should be replaced by a proper semantic cursor.

| File | What changed |
|------|-------------|
| `workflowStep.ts:57` | Step record status reads `result.status` instead of hardcoded `'complete'` |
| 4 step classes (10 error paths) | Return `{ status: 'error' }` instead of `{ status: 'complete' }` |
| `coverageValidationStep.ts:99-108` | Diagnostic artifact insert wrapped in try/catch to avoid FK crash |
| `sessionRoutes.ts:127-128` | Retry endpoint sets `walkCursor: 0` |
| `sessionRoutes.ts:96` | Retry endpoint accepts sessions with `retry_failed_step_id` set |
| `app.ts:243` | `toLifecycleState` returns `'error'` for `initStatus === 'error'` |
| `ChatView.svelte` | Init error banner, retry button, hidden composer/context bar |
