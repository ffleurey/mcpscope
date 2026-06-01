# Execution Thinning And Queue Unification

## Objective

Return mcpscope to one simple execution model:

- the backend owns all execution orchestration
- the centralized scheduler queue is the only execution control plane
- all execution progress and result streaming flows through the scheduler event stream
- the frontend triggers actions and consumes one clear execution/event receiver

This cleanup is a prerequisite for clean benchmark support.

## Target State

After this task:

- every executable action is queued and executed by the scheduler
- no normal UI flow opens action-specific execution SSE streams
- the frontend has one execution/event receiver used by views
- session creation, initialization, turns, analysis run, and analysis step all follow the same control-plane rules
- benchmark work can be added as a thin orchestration/container layer on top of sessions and queue jobs

## Non-Goals

- add benchmark product features
- redesign the runtime model
- broaden CLI/MCP surface unless needed for parity with the cleaned execution path

## Iteration 1: Backend Execution Unification

### Goal

Make the scheduler the only execution owner for executable work.

### Required outcome

- session initialization is scheduler-driven
- primary turn execution is scheduler-driven
- analysis execution and single-step analysis execution are scheduler-driven
- no route or operation directly executes work outside the scheduler in normal runtime flow
- backend state transitions and terminal outcomes are emitted through scheduler events

### Specific expectations

- remove or retire leftover direct execution paths and detached execution fallbacks from the normal app path
- keep one canonical admission path for execution requests
- keep compatibility adapters only if necessary, but they must delegate to the same scheduler-owned path
- avoid parallel implementations of the same execution semantics

### Verification gate

- there is one canonical backend execution path for each executable action
- `npm run check:backend`
- `npm test`
- focused scheduler and analysis slices remain green

## Iteration 2: Frontend Execution Simplification

### Goal

Reduce the frontend to trigger actions and consume one centralized execution/event receiver.

### Required outcome

- the frontend has one execution subscription path
- `executionStore` is the sole receiver of execution progress/events
- `sessionStore` no longer owns execution orchestration or opens execution SSE connections
- views consume derived state from stores rather than coordinating execution flows themselves

### Specific expectations

- remove action-specific execution streaming clients from normal UI flow
- keep session selection, trace viewing, and local view state separate from execution control
- preserve live trace updates, including per-session progress, through the centralized receiver

### Verification gate

- normal UI execution uses one backend event stream path
- `npm run check`
- `npm test`
- manual sanity checks:
  - create session and observe initialization progress
  - send turn and observe live progress
  - launch analysis, run, pause/resume if supported, and single-step analysis

## Iteration 3: Surface Cleanup And Benchmark Readiness Gate

### Goal

Remove overlapping execution surfaces and leave one clear contract for future benchmark orchestration.

### Required outcome

- obsolete execution routes/helpers are removed or clearly marked as compatibility shims
- execution-related API contracts are simple and non-overlapping
- docs describe the single execution model clearly
- benchmark addition can reuse session constructors, queue jobs, and the centralized execution stream without adding special execution plumbing

### Specific expectations

- document the canonical flow from trigger -> enqueue -> scheduler execution -> scheduler events -> view state
- keep CLI/MCP semantics coherent with the cleaned backend execution model where applicable
- do not leave dead or half-supported transitional code paths behind

### Verification gate

- `npm run check:backend`
- `npm run check`
- `npm test`
- docs updated for the canonical execution path
- explicit handoff note: benchmark support should only need container/orchestration work, not new execution infrastructure

## Final Acceptance Criteria

- execution ownership is backend-only and queue-only
- result streaming is centralized
- frontend execution handling is visibly thinner and simpler
- duplicated transitional execution logic is removed
- the codebase is in a clean enough state to add benchmarks as a thin layer above sessions