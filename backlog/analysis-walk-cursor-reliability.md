# Analysis workflow: walk cursor & retry reliability

## Summary

The analysis session framework uses a linear walk cursor over a flattened hook
list to drive multi-step workflows. The cursor is a fragile implicit pointer —
it has no correlation to the actual semantic unit of work being performed.
This causes three distinct failure modes that are currently untracked.

## Background

Analysis sessions (full session analysis, fast session analysis, fast tool analysis)
execute by flattening the target session tree into a linear list of hook calls
(`beforeSession`, `onToolCall`, `afterTurn`, `afterSession`, etc.) and walking
through them one at a time. The `walkCursor` (an integer index into this list)
is the only mechanism for tracking progress.

Each `resumeOneStep()` call advances by at most one hook position, then persists
the entire `AnalysisSessionState` (including `walkCursor`) to the DB. The system
relies on this persisted state to resume interrupted or retried analysis runs.

## Root cause analysis

### Issue 1: walk cursor cannot regress on retry

**`backend/src/routes/sessionRoutes.ts`** — `resetFailedAnalysisStepForRetry`

When an analysis step fails (`ToolCallAssessmentStep` returns `status: 'error'`),
the hooks' `state.phase` is set to `'error'`. The walk cursor, however, has
already advanced past the hook that created the failing step.

The retry endpoint changes `phase` back to a non-terminal retry phase
(e.g. `'assessing'`), but until recently it left `walkCursor` unchanged.
Since the cursor is past the failing hook, the next `resumeOneStep()` call
never reaches it — the analysis runs but skips the failed assessment.
Coverage validation subsequently detects the gap and reverts phase to `'error'`.

**Current fix:** `walkCursor` is now reset to 0 on retry. This is correct
but causes a full re-walk of all hooks from the beginning. Most hooks are
no-ops because they have guards (`bootstrapComplete`, `nextPacketIndex`
range checks, `finalAggregationComplete`), but the re-walk is wasteful and
relies on every hook having correct idempotency guards.

**Evidence:** Session 8WDH had `walkCursor: 46` after a retry that should
have reset it to 0. The old code (without the reset) was running when the
retry was performed. After deploying the fix, the retry endpoint correctly
sets `walkCursor: 0`.

### Issue 2: walk cursor does not detect new turns in the target session

The walk cursor is an opaque index into a flat list built when the analysis
session starts. If the target session receives new turns after the analysis
begins, the hook list would need to be rebuilt — and the walk cursor would
need to be positioned to include the new turns.

Currently, `flatten()` (which builds the hook list) reads the target session
freshly from the DB each time `resumeOneStep()` is called (because
`this.hookList = null` at the top of `resumeOneStep`). So the hook list
reflects the current state of the target session. The walk cursor, however,
is an index into the PREVIOUS hook list length. If the target session grew,
the new positions at the end of the list would never be reached because the
cursor is already past them.

**Evidence:** No session has been observed hitting this case yet, but the
code path is exercised every time `resumeOneStep()` nulls and rebuilds the
hook list from the DB — the cursor is not adjusted for list size changes.

### Issue 3: FK constraint failed on re-executed sessions

**`backend/src/analysis/coverageValidationStep.ts:44-72`**

The coverage validation diagnostic artifact is inserted with `stepId` set to
`this.state.analysisSessionId` (the session ID, e.g. `8WDH`). The `artifacts`
table has a FK constraint `step_id → v2_steps(id)`. Since there is no step
with ID `8WDH` (steps are `8WDH.1W`, `8WDH.2W`, etc.), this FK fails when
the backend enables `PRAGMA foreign_keys = ON`.

This failure only manifests when coverage validation actually detects missing
assessments (i.e. when the walk cursor is past the failing hooks). In sessions
that complete normally, coverage validation passes without inserting a
diagnostic artifact.

**Evidence:** Session 8WDH shows the error in the scheduler log:
```
"err":"FOREIGN KEY constraint failed","msg":"Scheduler job failed"
```
The session's `analysis_state_json` has `phase: 'assessing'` and
`walkCursor: 46` (from the previous retry under old code before the
`walkCursor: 0` fix).

## How the walk cursor currently works

### Hook list construction

`AnalysisSessionBase.flatten(tree)` at `analysisSessionBase.ts:263-322`

The tree is built from the target session's turns, rounds, and parts.
Hook entries are positional — they contain `methodName` and a bound `fn()`
callback. The ordering is:

1. `beforeSession`
2. Setup hooks (`beforeSetup`, `onSystemPrompt`, `onMcpInstructions`,
   `onToolDefinitions`, `afterSetup`)
3. Step/turn/round hooks for each step, each turn, each round, each part
4. `afterSession`

The list is rebuilt on every `resumeOneStep()` call because `this.hookList`
is set to `null` at the start of the method.

### Walk execution

`resumeOneStep()` at `analysisSessionBase.ts:325-345`

- Sets `singleStepLimit = 1`
- Calls `walk(tree)` which iterates from `walkCursor` to list end
- For each item: calls `fn()`, increments cursor, checks single-step limit
- Calls `saveState()` which persists `AnalysisSessionState` to DB

### Persistence

`saveState()` at `analysisSessionBase.ts:351-353`

Writes the entire `AnalysisSessionState` (including `walkCursor`, `phase`,
`nextPacketIndex`, `bootstrapComplete`, `coverageValidated`, etc.) to the
session's `analysis_state_json` column.

## Architectural considerations

### Linear index vs semantic cursor

The current cursor is an `int` index into a positional list. A semantic
cursor would reference the *conceptual position* in the workflow:

- For tool call assessment: `{ phase: 'assessing', packetIndex: N }`
- For turn summary: `{ phase: 'turn_summary', turnId: ID }`
- For final aggregation: `{ phase: 'final_aggregation' }`

This is partially what `nextPacketIndex` and `currentTurnId` already do,
but they are secondary hints, not the primary position mechanism.

### Hook guards vs idempotency contracts

Every hook method has its own guard logic (`if (bootstrapComplete) return`,
`if (packets[nextPacketIndex]?.tool_call_part_id !== part.id) return`, etc.).
These guards are inconsistent in coverage — some hooks (like `afterSession`)
lack guards for error-phase early-exit, causing them to create new steps
even when the analysis should stop.

### What a robust design would need

1. **Semantic position, not linear index** — The cursor should reference
   the actual unit of work (packet, turn, aggregation), making retry a
   simple index regression rather than a full re-walk.

2. **Idempotent hooks with explicit contracts** — Every hook should either
   be fully guarded (early-return on repeated call) or explicitly checkpointed
   so the framework knows which hooks produce state changes.

3. **Session-level transaction for retry** — `resetFailedAnalysisStepForRetry`
   currently excludes parts from the failed turn but doesn't reset the step
   record or re-initialize the assessment state. A transaction that atomically
   resets all artifacts, step records, parts, and the analysis state would
   eliminate FK issues and dangling state.

4. **New-turn detection** — The hook list rebuild already picks up new turns.
   The cursor regression logic should detect that the list grew and adjust
   (or reset to the first new-turn position rather than 0).

## Test-first status

Each issue below has a regression test written first (before applying the fix).
Tests marked **pass** mean the fix is already in place. Tests marked **fail**
mean the bug is still present and the test correctly reproduces it.

| # | Issue | Regression test | Location | Status |
|---|-------|----------------|----------|--------|
| 1 | `WorkflowStep` persists `status='complete'` even when `run()` returns `{ status: 'error' }` | Step record has `status: 'error'` after `run()` returns error | `workflowStep.test.ts` | ✅ Fixed, test passes (fix: `workflowStep.ts:57` checks `result.status`) |
| 2 | Step status persisted as `'complete'` when `run()` throws | Step record has `status: 'error'` after `run()` throws | `workflowStep.test.ts` | ✅ Already worked, test passes |
| 3 | Retry endpoint does not reset `walkCursor` | After `retry-failed-step`, `analysisState.walkCursor === 0` | `sessionMetadata.test.ts:896` | ✅ Fixed, test passes (fix: `sessionRoutes.ts:128`) |
| 4 | Coverage validation crashes with FK when `stepId` is a session ID | `runCoverageValidationStep` with `stepId: 'ANLY'` returns `{ passed: false, phase: 'error' }` without crashing | `analysisWorkflow.test.ts` | ✅ Fixed, test passes (fix: `coverageValidationStep.ts:99-108` catches FK) |
| 5 | New turns in target session not picked up by cursor | — | Not written yet | ❌ No test |

### Tests still to write

**Issue 5 — new turns in target session**
- Create target session with 2 turns, start analysis, partially execute
- Add turn-3 to the target session (insert turn + rounds + parts)
- Call `resumeOneStep()` and verify the new turn's hooks are reached
- Expected: cursor advances past the old hook list end into the new turns

This test requires constructing an `AnalysisSessionBase` subclass (e.g.
`FastSessionAnalysis`) with a mock gateway, calling `execute()` or
`resumeOneStep()` directly, and checking `walkCursor` position vs DB changes.

## Proposed work items

1. **Fix coverage validation FK** — Change the call site (`afterSession` in
   `fullSessionAnalysis.ts`, `fastSessionAnalysis.ts`, `fastToolAnalysis.ts`)
   to pass a valid stepId instead of `this.state.analysisSessionId`. Options:
   - Create a synthetic step record before calling coverage validation
   - Extract a diagnostic step ID helper
   
   Once fixed, the regression test in issue 4 will need to be updated:
   change `toThrow(FOREIGN KEY)` to verify the diagnostic artifact was created.

2. **Retry transaction** — In `resetFailedAnalysisStepForRetry`, also
   delete/re-create the failed step record and its owned turns/parts
   within the same transaction, rather than excluding parts in-place.

3. **Semantic cursor** — Replace `walkCursor` with a phase-aware position:
   - `{ kind: 'assess', packetIndex: 3 }`
   - `{ kind: 'turn_summary', turnId: '...' }`
   - `{ kind: 'final_aggregation' }`
   This makes retry a direct index regression with no full re-walk.

4. **Hook guard audit** — Audit all hook implementations for missing
   early-return guards when the phase has moved past their work.

5. **New-turn handling** — Write the regression test for issue 5 first,
   then implement cursor regression logic.

## Fixes already applied

- `workflowStep.ts:55-56`: step record status now checks `result.status`
  (was hardcoded to `'complete'`).
- 4 step classes: 10 error return paths now return `{ status: 'error' }`
  instead of `{ status: 'complete' }`.
- `coverageValidationStep.ts:99-108`: `insertJsonArtifact` for diagnostic
  artifact is wrapped in try/catch so a FK error from a missing step record
  doesn't crash the analysis.
- `sessionRoutes.ts:127`: `resetFailedAnalysisStepForRetry` now sets
  `walkCursor: 0`.
- `sessionRoutes.ts:96`: retry endpoint also accepts sessions with
  `retry_failed_step_id` set (not just `phase === 'error'`).
- Backend `app.ts:243`: `toLifecycleState` now returns `'error'` for
  `initStatus === 'error'`.
- `ChatView.svelte:203`: `isInitializing` excludes `'error'` state.
- `ChatView.svelte:440-447`: init error banner with retry button.
- `ChatView.svelte:453`: composer hidden during init error.
- `ChatView.svelte:545`: context bar hidden during init error.
