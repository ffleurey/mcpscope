# Global session execution lock

This task adds a **global single-active-session rule** so mcpscope cannot run overlapping experiments across multiple sessions.

## Problem

The current lifecycle MVP only protects turn concurrency **within one session**.

Today:

- `mcpscope create` can create and initialize multiple sessions in parallel
- `mcpscope send` blocks only when the **same** session already has an active turn
- another session can still start work while a different session is already initializing or running

That is a bad fit for the intended testing workflow.

When a tester or coding agent runs batch scripts, they can accidentally create overlapping experiments that compete for the same LM/MCP runtime and make results harder to interpret.

## Goal

Make mcpscope enforce a simple invariant:

> **At most one session may be active globally at a time.**

For the current product, "active" means a session is either:

- still initializing
- or currently executing a turn

## Desired behavior

### 1. Creating a session

`POST /api/sessions/from-defaults` must reject creation when another session is already active.

The same rule should apply to the older explicit-snapshot creation route:

- `POST /api/sessions`

That means creation should fail if **any existing session** is in one of these states:

- `initStatus = pending`
- `initStatus = initializing`
- has a turn with status:
  - `draft`
  - `streaming`
  - `awaiting-tools`

The intent is:

- do not allow users or scripts to queue up multiple fresh experiments
- force the current experiment to reach a quiescent state before starting another one

### 2. Starting a turn

`POST /api/sessions/:sessionId/turns/start` must reject when a **different** session is already active.

The same global rule should also apply to the older turn-entry routes:

- `POST /api/sessions/:sessionId/turns`
- `POST /api/sessions/:sessionId/turns/stream`

This is in addition to the existing per-session check that already rejects a second active turn inside the same session.

The result should be:

- one session can initialize
- or one session can run a turn
- but no second session can start work until the active one becomes quiescent again

### 3. Quiescent sessions

A session should count as **not active** when it is effectively idle:

- initialization finished successfully and no turn is active
- initialization failed and no recovery work is in progress
- the last turn finished or failed and no turn is currently active

In other words, the global lock is about **work in progress**, not about preventing the existence of multiple saved sessions.

## API expectations

Add one machine-readable conflict code for this global lock.

Recommended code:

- `another_session_active`

Recommended response shape:

```json
{
  "api_version": 1,
  "error": {
    "code": "another_session_active",
    "message": "Another session is currently active. Nothing was started.",
    "active_session": {
      "id": "ABCD",
      "state": "running"
    }
  }
}
```

Notes:

- **409 Conflict** is the appropriate status
- the payload should identify the blocking session when possible
- the blocking state should use the CLI-facing lifecycle vocabulary:
  - `initializing`
  - `running`

## Scope

### Backend

- add a reusable backend check for "is any other session active?"
- enforce it in:
  - `POST /api/sessions`
  - `POST /api/sessions/from-defaults`
  - `POST /api/sessions/:sessionId/initialize`
  - `POST /api/sessions/:sessionId/turns/start`
  - `POST /api/sessions/:sessionId/turns`
  - `POST /api/sessions/:sessionId/turns/stream`
- keep the existing per-session `turn_in_progress` guard
- add deterministic tests for:
  - create blocked by another initializing session
  - create blocked by another running session
  - initialize blocked by another active session
  - turn start blocked by another running session
  - turn start blocked by another initializing session
  - synchronous and streaming turn entrypoints blocked by another active session

### CLI

- surface the new conflict cleanly in `create`
- surface the new conflict cleanly in `send`
- if the API returns the blocking session ID, show it in human-readable output

### UI

The Web UI should stay behaviorally aligned with the backend:

- if session creation is blocked by another active session, show the backend error clearly
- if turn start is blocked by another active session, show the backend error clearly

No major UI redesign is required for this task.

## Important design notes

- this is a **global execution lock**, not just a session-local turn lock
- it should be implemented in backend logic, not only in the CLI or UI
- it should not prevent inspection of old sessions
- it should not prevent listing sessions
- it should not prevent retaining multiple completed sessions
- the lock must cover both the new CLI-oriented routes and the older direct UI/backend execution routes so behavior stays consistent everywhere
- the check should be made atomically with the action that starts work, otherwise two concurrent requests could still slip through

## Open point to settle during implementation

The main remaining design choice is whether a session that is merely **initializing** should also block `turns/start` in another session.

Recommended answer: **yes**

Reason:

- the requested behavior is "only one experiment in flight"
- initialization is part of starting an experiment
- allowing one session to initialize while another runs would weaken the intended serialization rule

## Expected result

After this task:

- users can still keep many completed sessions
- but only one session can be actively initializing or running at a time
- scripts that try to fan out multiple experiments in parallel will fail fast and clearly instead of creating overlapping runs
