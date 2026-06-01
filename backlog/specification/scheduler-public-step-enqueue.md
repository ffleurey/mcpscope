# Scheduler public step enqueue

The scheduler now has backend support for step-target execution internally, but the public scheduler API is still effectively session-only.

Today:

- `ExecutionTarget` includes both `session` and `step`
- the scheduler implements `enqueueStep(...)`
- analysis single-step execution uses that capability through a dedicated compatibility path
- the generic scheduler enqueue route and frontend client still only expose session enqueueing

This should be handled as a separate increment from the current pause-boundary fix so the branch can stay focused on execution semantics.

## Goal

Expose real step-target enqueueing through the public scheduler contract across backend routes, typed client helpers, and any relevant UI or adapter entrypoints.

## Why separate this from the current branch

The current branch is primarily about making execution control correct:

- stop at the next step boundary when paused
- preserve resumability from persisted state
- keep analysis single-step behavior correct

Public step enqueue is a different slice:

- route contract design
- adapter parity
- frontend API exposure
- queue UI behavior for explicit step jobs

That work is straightforward in concept but broader in touched surfaces, so it should land independently unless it becomes strictly necessary for another queued feature.

## Required outcome

- the generic scheduler enqueue route accepts both session and step targets
- backend validation errors for invalid step targets are exposed intentionally at the HTTP boundary
- frontend/client types can enqueue step jobs without relying on analysis-specific wrappers
- tests cover step enqueue success and rejection through the public route, not only through internal scheduler methods

## Likely implementation surfaces

- `backend/src/app.ts`
- `backend/src/runtime/scheduler.ts`
- `backend/src/operations/errors.ts`
- `backend/src/app.test.ts`
- `frontend/src/lib/backendTypes.ts`
- `frontend/src/lib/api/backendClient.ts`
- `frontend/src/lib/executionStore.ts`
- any queue UI surface that should display or create explicit step jobs

## Validation expectations

- app-level tests for public step enqueue success and rejection
- route-level test for stable status codes on `step_not_found` and `step_not_ready`
- frontend/client tests if new step enqueue helpers are added
- `npm run check:backend`
- `npm run check`
- `npm test`