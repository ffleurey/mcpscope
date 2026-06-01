# Execution scheduler gap closure

This task is the follow-up implementation handoff for the scheduler work reviewed in PR #20.

The scheduler branch is directionally correct, but it is not ready to merge. The follow-up must close the concrete gaps found in review rather than reopen the scheduler design.

## Reviewed gaps to close

### 1. Step-target scheduling is declared but not actually implemented

The public scheduler model exposes `ExecutionTarget = session | step`, but the admitted and executable path only supports session enqueueing.

Concrete symptoms seen in review:

- `backend/src/runtime/scheduler.ts` defines `kind: 'step'` and step-specific scheduler error codes
- `backend/src/app.ts` only exposes enqueue payloads shaped around `session_id` and optional `prompt`
- the current backend client only exposes session enqueueing
- the task accepted for the original scheduler explicitly required generic queueing over session and step targets

This is not a documentation mismatch. It is a functional gap in the core contract.

### 2. Analysis single-step execution regressed

The frontend still sends `single_step=true` for the analysis Step button, but the new `/api/sessions/:sessionId/execute` path now always schedules a full session continuation.

Concrete symptoms seen in review:

- `frontend/src/lib/sessionStore.ts` still uses the single-step execution path for the Step button
- `frontend/src/lib/api/backendClient.ts` still generates the `single_step=true` query
- `backend/src/app.ts` no longer reads the query parameter
- scheduler analysis execution currently routes into full-session resume semantics

This is a user-visible regression and must be restored before merge.

### 3. Stream continuity across session switching is incomplete

The new global execution store records session-keyed events while another session is selected, but the selected session view does not replay those cached events when the user navigates back.

Concrete symptoms seen in review:

- `frontend/src/lib/executionStore.ts` records per-session events in `sessionStreamCache`
- helper accessors exist for the cache
- `frontend/src/lib/sessionStore.ts` primes a fresh empty `activeTurnStream` when reopening a running session instead of rebuilding from cached events

The original task explicitly required robust live streaming while toggling between sessions, so this is still missing functionality rather than optional polish.

### 4. Step scheduler error codes are not yet mapped cleanly to HTTP responses

The scheduler defines `step_not_found` and `step_not_ready`, but shared HTTP error mapping does not yet assign them stable status codes.

This is smaller than the issues above, but it must be closed as part of landing step-target scheduling.

## Goal

Land a focused follow-up that makes the scheduler feature correct against the already-approved task and current UI expectations by:

- implementing real step-target enqueue and execution support end to end
- restoring single-step analysis execution through the scheduler path
- making stream continuity survive session switching in the frontend
- adding the regression coverage needed to keep those behaviors stable

## Non-goals

- redesigning the scheduler architecture
- adding queue persistence across backend restart
- adding concurrent execution
- adding arbitrary queue reordering
- changing the user-facing execution bar beyond what is needed to support the corrected behavior
- broad refactors outside the scheduler, analysis execute path, or stream-state ownership needed for this fix

## Canonical docs and code anchors

Read in this order:

1. `backlog/implementation/execution-scheduler.md`
2. `AGENTS.md`
3. `README.md`
4. `ARCHITECTURE.md`
5. `DATA-MODEL.md`
6. `TESTING.md`

Start implementation from these files:

- `backend/src/runtime/scheduler.ts`
- `backend/src/app.ts`
- `backend/src/operations/send.ts`
- `backend/src/operations/executeAnalysis.ts`
- `backend/src/operations/errors.ts`
- `backend/src/analysis/analysisSession.ts`
- `backend/src/domain/executionModel.ts`
- `backend/src/app.test.ts`
- `frontend/src/lib/backendTypes.ts`
- `frontend/src/lib/api/backendClient.ts`
- `frontend/src/lib/executionStore.ts`
- `frontend/src/lib/sessionStore.ts`

## Required end state

By the end of this task, all of the following must be true:

- the backend can enqueue both session targets and step targets
- step-target admission rejects non-ready or non-next steps with stable error codes and statuses
- the analysis Step button advances exactly one runnable step and then stops
- the analysis Run path still continues the full analysis session as before
- switching away from a running session and back does not lose visible live streamed progress that arrived while the session was not selected
- automated tests cover the corrected backend and frontend state behavior closely enough to catch regressions

## Step-by-step plan

### Milestone 1. Close the backend contract gap for step enqueueing

Goal:

- make the scheduler truly generic over session and step targets in the admitted API and execution path

Required changes:

- add an explicit scheduler enqueue API contract that can represent both target kinds without adapter ambiguity
- implement scheduler admission for step targets
- validate that a step target belongs to the given session and is the next runnable step for that session
- ensure that executing a step target runs exactly that step and does not continue the full session afterwards
- keep the existing one-job-per-session deduplication rule intact for both session and step targets
- map `step_not_found` and `step_not_ready` to appropriate HTTP status codes in shared error handling

Preferred implementation shape:

- keep the public scheduler API generic over `ExecutionTarget`
- avoid introducing workflow-specific job kinds to represent analysis step execution
- prefer routing the HTTP, CLI, and MCP entrypoints through the same backend-owned scheduler admission logic rather than adding adapter-only special cases

Automated validation required before moving on:

- backend unit or app-level tests for step-target enqueue success
- backend unit or app-level tests for rejecting a nonexistent step target
- backend unit or app-level tests for rejecting a not-ready or not-next step target
- backend unit or app-level tests for duplicate-target or duplicate-session rejection when a session already has active or pending work
- backend test that verifies step-target errors map to stable HTTP status codes instead of falling through as 500

Gate:

- do not proceed until a test proves that a concrete step target can be enqueued and executed without full-session continuation

### Milestone 2. Restore single-step analysis execution on top of the scheduler

Goal:

- make the existing analysis Step control correct again without reopening the UI contract

Required changes:

- preserve or reintroduce an execute-path contract that can request one-step analysis execution
- route that request into scheduler step-target execution rather than full-session enqueueing
- keep the full analysis execute path intact for normal Run behavior
- verify that the backend emits compatible execution events for both cases

Implementation guidance:

- the preferred end state is that the Step button uses scheduler step-target semantics explicitly
- compatibility wrappers are acceptable during transition if they stay thin and keep the backend semantics centralized
- do not keep a second long-term detached execution path just to support stepping

Automated validation required before moving on:

- backend or app test proving `/execute?single_step=true` advances one step only, if the compatibility query remains supported
- or backend or app test proving the new step-oriented endpoint used by the Step button advances one step only, if the client contract is changed deliberately
- regression test proving normal analysis execution still continues until block or completion
- frontend store or integration-level test proving the Step control selects the single-step path and does not trigger full-session continuation

Gate:

- do not proceed until the Step button semantics are restored and covered by an executable regression test

### Milestone 3. Finish session-switch stream continuity

Goal:

- make live execution rendering survive navigation away from and back to a running session

Required changes:

- define the intended ownership of session-keyed streamed events in the global execution store
- replay or rehydrate cached session events into the selected session's live state when the user reopens that session mid-execution
- ensure terminal completion or trace refresh still clears or supersedes cached live state correctly
- avoid duplicating events when a session is already selected and receiving live updates directly

Implementation guidance:

- keep canonical execution ownership in the backend
- keep the frontend fix focused on state reconstruction, not on inventing new backend semantics
- prefer deterministic store-level logic that is easy to cover with tests

Automated validation required before moving on:

- frontend store test for caching execution events while session A is not selected
- frontend store test for selecting session A later and reconstructing visible live streaming state from cached events
- frontend store test for avoiding duplicate replay when already subscribed to the live selected session
- if existing frontend test infrastructure makes this too awkward, add the narrowest deterministic store test possible rather than relying only on manual UI checks

Gate:

- do not proceed until there is an automated proof that switching sessions no longer drops transient live progress from the visible session stream

### Milestone 4. Align public types, adapters, and tests around the corrected contract

Goal:

- remove misleading partial support and make every exposed surface consistent with the real scheduler behavior

Required changes:

- align backend route schemas, operation types, and frontend types with actual scheduler target support
- ensure the frontend client exposes the real enqueue and execute shapes it now uses
- update or add only the documentation needed to keep the scheduler task and implementation aligned
- extend app-level regression coverage where route wiring changed materially

Automated validation required:

- `npm run check:backend`
- `npm run check`
- `npm test`
- any newly added focused frontend or backend tests for the touched slices

Gate:

- do not call the branch ready until the typed contract, runtime behavior, and test coverage all agree on step-target support and stream continuity

## Suggested execution order inside the branch

1. Make the backend scheduler admit and execute step targets.
2. Add or update backend tests for step-target scheduling and HTTP mapping.
3. Restore analysis Step behavior by routing it through scheduler step execution.
4. Add the regression test that proves single-step analysis no longer runs the full workflow.
5. Fix frontend session-stream cache replay and state reconstruction.
6. Add deterministic frontend tests for session-switch continuity.
7. Align route schemas, client types, and any thin compatibility wrappers.
8. Run the full required validation set.

## Manual verification after automated checks

Automated tests are required for the core behavior above. After they pass, do this manual verification in the app:

1. Start an analysis session with multiple remaining steps.
2. Use the Step control once and verify only one additional step completes.
3. Use the Run control and verify the remaining analysis continues normally.
4. Start a long enough live execution to observe streamed output.
5. Switch to a different session while output is still streaming.
6. Return to the running session and verify the visible live stream includes progress that arrived while it was not selected.
7. Inspect the execution bar and queue state while the above is happening and confirm it remains coherent.

## Acceptance criteria

- scheduler enqueue is genuinely generic across session and step targets
- analysis stepping is no longer regressed
- session-switch live streaming is functionally complete for the selected-session UI
- step-specific scheduler errors are stable and intentional at the HTTP boundary
- the branch includes focused automated regression coverage for each reviewed gap
- no parallel execution, persisted queueing, or unrelated scheduler redesign was introduced

## Deliverables from the coding agent

- branch name
- short summary of the implementation approach
- list of automated tests added or updated for each gap
- exact validation commands run and their results
- any remaining risks or follow-up items that should stay out of this branch