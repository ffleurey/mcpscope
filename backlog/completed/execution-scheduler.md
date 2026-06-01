So far we do not really have an execution engine in the backend. Each session has an execution semantics and we have defined a stricly sequencial execution policy.

Completion note:

- Landed on the `execution-scheduler` branch with backend-owned queueing, global execution monitoring, execution-bar UI, and boundary-based stop/resume semantics.
- Public generic step enqueue was split out afterwards into `backlog/specification/scheduler-public-step-enqueue.md` rather than widening the branch again.

To prepare for more advanced scenarios and allow for easily controling and following the execution of sessions, analysis sessions and later benchmarks we would benefit from a more proper centralized execution queue and engine.

This can be quite simple and the idea is with it is actually to simplify what we have today by having a central queue which can be managed to to which "jobs" can be added. The granularity we want to have is the session, step or turn, we want to remian with one queue and sequencial execution. No parallel and concurency for now.

This meand that multiple sessions could be queues to run, including analysis sessions. We will always try to run full session and not jump between turns of different sessions but that can be the responsability of the component enqueing the jobs.

In the API and UI, we need to be able to monitor the state of the queue, monitor the state of the execution, what is being executed and what is the progress and we need to be able to start, pause, resume and edit the jobs in the queue. Remove a specific turn or remove a session, etc. 

It should not be possible to have multiple jobs for the same session because either what is enqueued is the whole session or it is a step or turn. There can be only one step at the time ready for execution in our session execution model so it is not possible to enqueue more than one step. The schedulaer should check and reject enquing anthing which is not ready to run (ie has all its inputs).

In the UI, I believe that the execution bar could be in the top bar, with the live status, the control button and some sort of drop down that can show the queue and allow removing jobs.

If stoping the queue or pausing teh queue, the granularity is the turn/step. Not sure we are able to easily interrup a turn which is already running in lmstudio for example but we should check. If a step/turn is completed then it should be possible to resume later the session from the next turn. If a turn is not completed, the it shoudl be possible to "re-run" that turn to get back on track.

One goal for the task is also to restore a robust ability to stream the execution with live streaming of all the llm outputs to the frontend even when toggling between different sessions in the frontend. Probably that the streaming could be centralised as part of the execution monitoring instead of being per session or chat.

---

# Execution scheduler implementation plan

This task turns the existing per-route execution behavior into a backend-owned generic scheduler with one sequential worker, one in-memory queue, and one global execution-monitoring surface.

The scheduler is intentionally generic over `Session` and `Step` targets. A `Turn` is not modeled as a separate queue concept; it is queued as a `Step` because `Turn` is the LLM-specific step subtype in the project runtime model.

This task includes the backend execution engine, the API surface, the migrated existing execution entrypoints, and the frontend execution UI needed to test the feature end to end.

## Why this task exists

mcpscope already has the execution vocabulary needed for this work:

- `Session` is the execution container
- `Step` is the execution unit
- `Turn` is the LLM-specific step subtype
- sessions already expose explicit execution-loop boundaries through `execute()` / `advance()` / `canContinue()`

What it does not yet have is a central control plane for execution.

Today:

- primary-session execution is launched directly from the send path
- analysis execution is launched directly from its execute path
- the backend applies the single-active-session rule ad hoc at those entrypoints
- streaming is attached to per-session actions instead of a global execution monitor
- the frontend treats live execution as belonging to the currently selected session rather than to the backend-owned active run

That fragmented ownership now blocks the next level of product behavior:

- generic queueing of work
- queue inspection and control
- durable understanding of what is currently executing
- live execution monitoring while switching between sessions in the UI

## Goal

Introduce a backend-owned, generic, sequential execution scheduler that:

- accepts `Session` and `Step` targets into one in-memory queue
- enforces readiness and duplicate-target rejection before enqueue
- executes exactly one target at a time
- exposes a global execution snapshot and event stream
- migrates existing execution flows to enqueueing instead of direct detached execution
- gives the frontend a global execution bar and queue view that remains correct while the user switches between sessions

## Fixed decisions for this increment

- the queue is in memory only; it is not persisted across backend restart
- backend restart may clear queued work; users can re-enqueue based on persisted runtime state
- persisted runtime records remain the source of truth for what completed, what failed, and what remains to run
- the scheduler is generic over `Session` and `Step` targets; it is not modeled around `primary`, `analysis`, or other workflow-specific job kinds
- a `Turn` is queued only as a `Step`
- existing execution entrypoints should migrate to enqueueing rather than continuing to execute directly
- the scheduler remains strictly sequential; no parallel or concurrent execution is added in this task
- pause semantics are boundary-based: pausing prevents the next runnable step from starting, but does not promise interruption of an already-running LM or MCP request
- queue editing in this increment means control of pending jobs: inspect, remove, and resume around them; arbitrary target mutation is out of scope
- the execution-monitoring surface should be global and backend-owned so streaming survives frontend session switching

## Scope

### In scope

- generic scheduler types and orchestration service in the backend
- one in-memory queue plus one active execution slot
- generic enqueue validation for session and step targets
- migration of existing execution flows to use enqueueing
- execution snapshot API and global SSE monitoring API
- frontend global execution store and top-bar execution UI
- focused backend, app, and frontend regressions for scheduler behavior
- final manual UI verification of queue visibility, controls, and stream continuity while switching sessions

### Out of scope

- queue persistence across backend restart
- concurrent execution or per-model parallel lanes
- guaranteed mid-turn cancellation of in-flight LM Studio or MCP work
- arbitrary drag-drop queue reordering unless it falls out cheaply from the chosen backend model
- introducing workflow-specific scheduler concepts such as `analysis_job`
- redesigning the canonical runtime tree or reopening the `Session` / `Step` / `Turn` model

## Canonical docs and code anchors

Read these before implementation:

1. `README.md`
2. `ARCHITECTURE.md`
3. `DATA-MODEL.md`
4. `TESTING.md`

Start implementation from these files:

- `backend/src/domain/executionModel.ts`
- `backend/src/runtime/chatSession.ts`
- `backend/src/analysis/analysisSession.ts`
- `backend/src/operations/send.ts`
- `backend/src/operations/executeAnalysis.ts`
- `backend/src/persistence/repositoryRuntime.ts`
- `backend/src/app.ts`
- `backend/src/app.test.ts`
- `frontend/src/lib/backendTypes.ts`
- `frontend/src/lib/api/backendClient.ts`
- `frontend/src/lib/sessionStore.ts`
- `frontend/src/lib/traceStreaming.ts`
- the top-bar and session-view Svelte components that currently surface execution status

## Target model for this increment

The scheduler should introduce a small generic target model:

- `ExecutionTarget = { kind: 'session', sessionId } | { kind: 'step', sessionId, stepId }`
- `ExecutionJob` is a queued request to execute one target
- `ExecutionSnapshot` is the current backend-owned view of:
	- scheduler mode: running or paused
	- active job, if any
	- pending jobs
	- recent terminal job outcome, if retained in memory for UX/debugging

Important rules:

- a session may not have more than one active or pending job at a time
- a step may not be enqueued unless it is the next ready runnable step for its session
- enqueueing a session target means: let that session continue through its normal execution model until it blocks or completes
- enqueueing a step target means: execute exactly that one ready step
- the scheduler owns ordering across all queued work, but it does not invent new runtime semantics for how a session or step itself runs

The generic scheduler may internally dispatch to session-type-specific rehydration or execution code, but that behavior must stay behind a generic scheduler boundary.

## Readiness and deduplication rules

The backend must reject enqueue requests when any of the following is true:

- the target session or step does not exist
- the session is not in a schedulable state
- the target step is not the next ready runnable step for that session
- the target lacks required inputs according to existing session/step semantics
- the same session already has an active or pending job in the scheduler
- persisted runtime state already shows in-progress execution for the same target

The scheduler should treat restart recovery consistently with current behavior:

- on backend start, in-progress persisted turns or steps are recovered as interrupted by the existing runtime recovery path
- the in-memory queue starts empty
- users may re-enqueue from persisted runtime state after restart

## API and streaming direction

This task should introduce a generic execution-monitoring API rather than continuing to rely on per-route streaming ownership.

The exact route names may change during implementation, but the branch should land all of the following capabilities:

- enqueue a session target
- enqueue a step target
- fetch the current execution snapshot
- subscribe to scheduler-wide SSE events
- pause the scheduler
- resume the scheduler
- remove a pending job

The scheduler-wide SSE stream should carry at least:

- queue changes
- active job changes
- control-state changes
- streamed turn/round/part execution events, tagged with session and job identity
- job terminal events: completed, failed, removed, rejected when relevant to a subscribed enqueue flow

Existing per-session execution routes may remain temporarily during migration, but their behavior should be reduced to one of these patterns by the end of the task:

- thin compatibility wrapper that enqueues then relays matching scheduler events
- removed in favor of the new generic execution API and store flow

The branch should prefer the simpler end state rather than preserving redundant execution paths.

## Frontend direction

The frontend should stop treating the currently selected session as the owner of live execution.

Instead it should have:

- one global execution store fed by the scheduler snapshot and scheduler event stream
- session-keyed live streaming state so streamed deltas remain available while the user navigates to another session
- a top-bar execution surface showing:
	- current running or paused state
	- the active target and basic progress
	- pause or resume controls
	- a dropdown or panel showing pending queued jobs
	- removal controls for pending jobs

The transcript/session view should render live progress from the session-keyed streaming cache rather than only from the active selected session.

## Ordered implementation milestones

### Milestone 1. Introduce the generic scheduler model and in-memory ownership boundary

Goal:

- create the backend-owned scheduler types and service boundary without yet migrating all callers

Required outcomes:

- add generic `ExecutionTarget`, `ExecutionJob`, scheduler control-state, and snapshot types
- add one backend-owned scheduler service with one active slot and one pending queue
- make the scheduler explicitly in-memory and process-local for this increment
- define the service boundary that runs session and step targets without hard-coding workflow names into the public scheduler model
- preserve the existing restart-recovery behavior for persisted runtime records; do not add queue persistence

Exit criteria:

- one obvious backend ownership point exists for queue state and active execution state
- the scheduler model is generic over session and step targets
- no workflow-specific job taxonomy leaks into the scheduler contract

Gate before Milestone 2:

- confirm the scheduler contract can represent both full-session continuation and one-step execution without inventing `analysis job` or `primary job` concepts
- stop and narrow the contract if implementation starts requiring queue item types that mirror current session kinds

### Milestone 2. Implement admission, readiness checks, and worker execution

Goal:

- make the scheduler able to accept, reject, and run generic targets correctly

Required outcomes:

- implement enqueue validation for session and step targets
- enforce the no-duplicate-per-session rule across active and pending jobs
- implement the sequential worker loop that runs one job at a time
- implement boundary-based pause and resume behavior
- implement pending-job removal
- emit backend-owned scheduler events for queue changes and active-job transitions

Important behavior:

- enqueueing a session target should continue that session until it blocks or completes according to its existing execution semantics
- enqueueing a step target should execute exactly one ready step, including turns as step subtypes
- pausing must not start a new step after the current running step finishes
- this milestone should not promise hard interruption of an already-running step

Exit criteria:

- session targets and step targets can both be enqueued and executed through the same scheduler
- invalid or duplicate requests are rejected deterministically
- pause, resume, and pending removal work against scheduler state

Gate before Milestone 3:

- confirm that the worker is the only place where new execution starts
- stop if direct detached execution still exists as a competing backend path for the same runtime behavior

### Milestone 3. Migrate existing execution entrypoints to enqueueing

Goal:

- remove direct execution ownership from the existing route-level flows

Required outcomes:

- migrate the existing primary send flow so it reserves the new turn/step as needed, then enqueues rather than executing detached immediately
- migrate analysis execution so it enqueues a generic target rather than running directly from its route helper
- make route handlers thin transport adapters over scheduler enqueue and monitoring logic
- preserve existing persisted runtime semantics and error handling as much as possible while changing ownership
- ensure existing global lock behavior is either subsumed by the scheduler or reduced to scheduler-backed validation rather than duplicated independently

Important note:

- this migration is about ownership, not about changing what a primary or analysis execution does once it starts

Exit criteria:

- send and analysis execution no longer own their own detached worker semantics
- new execution starts through the scheduler
- route handlers read as enqueue, monitor, and transport framing code rather than orchestration engines

Gate before Milestone 4:

- confirm there is no remaining ambiguity about whether active execution is owned by routes or by the scheduler
- stop and simplify if legacy compatibility wrappers are starting to duplicate the new execution logic

### Milestone 4. Introduce global execution monitoring and frontend stream routing

Goal:

- make live execution observable independently of the currently selected session

Required outcomes:

- add backend snapshot and global SSE monitoring support
- extend frontend types and API client for scheduler snapshot and scheduler events
- create a global execution store in the frontend
- route live streamed turn events into session-keyed streaming state instead of only `activeTurnStream`
- preserve transcript rendering while the user switches between sessions during live execution

Important behavior:

- changing the selected session in the UI must no longer discard or orphan active streamed output for the actually running session
- the active session view should still update correctly when the running job belongs to the selected session
- a non-selected running session should continue to accumulate live data that becomes visible when re-selected

Exit criteria:

- live execution can be followed from the global execution store
- switching sessions does not break the underlying stream ownership model
- the frontend no longer depends on per-route streaming calls as the only source of truth for in-flight execution state

Gate before Milestone 5:

- confirm that frontend execution state is keyed by backend execution identity and session identity, not by current selection state
- stop and simplify if the store starts duplicating the backend scheduler state machine instead of reflecting it

### Milestone 5. Add top-bar execution UI and end-to-end controls

Goal:

- expose the scheduler in the product UI so the branch can be verified end to end

Required outcomes:

- add a top-bar execution surface that is visible during normal use
- show running vs paused status
- show the active target and queue length
- provide pause and resume controls
- provide a queue dropdown or panel listing pending jobs
- allow removing pending jobs from the queue UI
- show enough live progress to understand which session or step is currently running

UI interpretation for this increment:

- queue editing means removal of pending jobs
- arbitrary mutation of a queued target is not required
- if step names are noisy in the product UI, render a human-readable description rather than raw internal type keys when possible

Exit criteria:

- the UI exposes the scheduler clearly enough to run the final acceptance checks
- the backend and UI tell the same story about what is active, queued, paused, or removed

### Milestone 6. Validation, hardening, and backlog closeout

Goal:

- prove the scheduler works through focused automated checks plus final manual UI verification

Required outcomes:

- add focused deterministic backend tests for scheduler admission, deduplication, pause/resume, pending removal, and job execution ordering
- add app/API tests covering migrated enqueue flows and scheduler monitoring routes
- add focused frontend tests for store/event handling and session switching during live execution
- run the relevant backend and frontend type checks
- perform a final manual UI pass covering queue visibility and stream continuity

Exit criteria:

- the branch has focused automated coverage for the new control plane
- the UI behavior has been manually verified once against the acceptance checks below

## Validation plan

Automated validation should include at least:

- backend unit tests for scheduler state transitions and admission checks
- backend/app tests for:
	- enqueue session target
	- enqueue step target
	- reject duplicate work for the same session
	- pause then resume around step boundaries
	- remove pending job
	- migrated primary send flow
	- migrated analysis execution flow
	- scheduler-wide event stream shape
- frontend tests for:
	- global execution store updates from snapshot plus events
	- session-keyed streaming updates
	- switching active sessions while another session is streaming
- `npm test`
- `npm run check:backend`
- `npm run check`

Prefer focused backend and store tests over broad UI-heavy automation.

## Final acceptance checks

The branch is ready to move forward only if all of the following are true:

- execution starts through a backend-owned generic scheduler rather than route-local detached execution
- the scheduler accepts both session targets and step targets
- a step target is rejected when it is not ready to run
- the scheduler prevents multiple active or pending jobs for the same session
- the queue is in memory only and restart behavior remains acceptable because persisted runtime state still shows what completed or was interrupted
- pause stops the scheduler from starting the next step, and resume continues from persisted runtime state
- pending jobs can be inspected and removed through both API and UI
- live execution streaming remains visible and correct after switching between sessions in the frontend
- the top bar exposes current execution state and queue controls clearly enough for manual use
- existing send and analysis execution flows have been migrated to enqueueing

## Manual UI checklist

Use this at the end of the branch:

1. Start a session and enqueue normal execution from the UI.
2. Verify the top bar shows the active target and queue state.
3. Queue additional work for another session or step and verify it appears as pending.
4. Remove one pending job and verify both UI and backend snapshot update.
5. Pause while a step is running and verify the current step finishes but the next step does not start.
6. Resume and verify execution continues from persisted state.
7. Switch to another session while a session is streaming and verify live output continues to accumulate correctly.
8. Return to the running session and verify the transcript reflects the streamed output that arrived while it was not selected.
9. Restart the backend, confirm the queue is empty, and verify interrupted persisted state can be re-enqueued cleanly.

## Stop and escalate if

- generic step-level enqueueing proves impossible without first redesigning the persisted step readiness model
- the migration requires preserving two long-term competing execution engines
- queue persistence starts to look necessary for correctness rather than convenience
- mid-turn interruption becomes a hidden dependency for basic pause semantics
- the frontend cannot render correct stream continuity without first introducing a much broader trace/state rewrite
