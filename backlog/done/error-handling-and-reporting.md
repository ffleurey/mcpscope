## Completion note

This task is complete.

The main consolidation goals from this task are now in place:

- backend and frontend use a shared structured error model for normal request/response paths
- session creation now performs pre-flight validation and fails before creating a session when dependencies are not ready
- session creation errors are kept inline in the new-session flow, while operational/runtime errors use the dialog surface
- LM Studio and MCP connection tests now use consistent result dialogs with preserved details
- config screens now use the shared frontend error shape for local inline failures
- the remaining browser-side LM Studio testing-era calls were removed from the frontend

Related follow-up work was intentionally split into separate backlog items:

- `backlog/model-load-recovery.md`
- `backlog/streaming-error-and-sse-payloads.md`
- `backlog/mcp-tool-drift-detection.md`

Visual polish and UX refinement of some error dialogs is also separate from this completed consolidation pass.

We need a consistent error handling and reporting model across frontend and backend.

The goal is **not** clever recovery or interpretation. The goal is:

- report failures clearly to the user
- preserve the raw information we already have
- keep the UI and persisted state recoverable
- avoid silent failures and inconsistent error shapes

## Current findings

The project already catches many failures at the right boundaries, but the handling is fragmented.

- backend errors use multiple shapes today:
  - `{ error: string }`
  - `{ status: 'error', message: string }`
  - SSE failure events with ad-hoc payloads
- frontend errors are also split:
  - local inline `saveError` state in forms and config screens
  - global `sessionError` + dialog for chat/session failures
- some follow-up failures are swallowed with `.catch(() => undefined)`
- backend logging is too thin for route and service failures
- session creation / initialization is the main recoverability problem:
  - a session can be created
  - initialization can fail afterward
  - the user is left with a partial session and no clear retry path

## Product direction

- keep error handling simple and explicit
- do not try to anticipate every possible failure
- surface the actual message, status, and available raw details
- use a small number of consistent UI patterns
- prefer retry / back / adjust configuration over hidden fallback behavior

## Main use cases

### 1. MCP server or model unavailable

Every access to the MCP server or model can fail because the service is offline, unreachable, timed out, or returned an error.

Requirements:

- show a clear failure message
- preserve the actual backend error message and status when available
- let the user retry later or return to the previous screen
- do not leave the app in a dead-end state

Session-specific requirement:

- run pre-flight checks before creating a session
- if checks fail, do not create the session — surface the failure and let the user adjust configuration
- a session is only created when we are confident it can reach the ready state

### 2. Connection test reporting

The MCP and model test buttons should report the result in a proper dialog.

Requirements:

- report the real test outcome, not a legacy frontend-only/CORS-oriented message
- distinguish at least:
  - timeout
  - unreachable / connection refused
  - server error
  - invalid response / protocol error
  - other unexpected error
- show:
  - what was tested
  - the status/result
  - the raw message
  - the raw payload or details when available

We do not need to special-case every failure. We only need to expose the real one consistently.

### 3. Model not loaded

If the chosen model is not loaded for the selected LM Studio connection, the user should not just hit a failing session start path.

Requirements:

- show clearly which model is currently loaded for a connection
- when the user selects a model that is not loaded:
  - offer to load it
  - if needed, offer to unload the currently loaded model first
- apply the same logic when reopening an existing session whose model is no longer loaded
- keep the user in a recoverable path:
  - cancel
  - load model
  - return and adjust configuration

### 4. MCP tool definition drift

If an MCP server changes tool names, signatures, or descriptions after a session was created, continuing that session may no longer be representative.

Requirements:

- detect tool definition changes, not just implementation changes
- warn the user when the session tool definitions no longer match the currently available server definitions
- make it clear that the existing session is now stale relative to the live MCP server

## Implementation policy

### Backend

Use one error response contract everywhere outside success responses.

Suggested shape:

```ts
{
  error: {
    type: 'validation' | 'not_found' | 'upstream' | 'timeout' | 'internal'
    message: string
    code?: string
    details?: unknown   // raw upstream body, payload, or context — sent to client, this is a local tool
  }
}
```

Rules:

- use proper HTTP status codes for non-streaming endpoints
- use the same logical fields in SSE failure events
- preserve upstream status/message/details where available
- log failures with context such as route, session id, turn id, model, or MCP profile when relevant
- do not silently collapse all failures to a generic message unless no better information exists

### Frontend

Capture errors in one consistent shape even if the UI surface differs.

Suggested shape:

```ts
{
  message: string
  type?: string
  code?: string
  statusCode?: number
  details?: unknown
  source?: string
}
```

Rules:

- keep the raw backend message
- include status code and structured details when available
- remove silent catches unless they are intentionally non-user-facing and logged
- keep transient UI state recoverable after failure
- use a dialog for richer operational/test/session errors
- use inline errors only where they are clearly local to a form

## Detailed implementation plan

### 1. Define the shared backend error model

- add a small backend helper for creating error responses
- standardize route failures in `backend/src/app.ts`
- standardize test endpoint failures
- standardize streaming failure events so they carry the same fields as normal error responses

Outcome:

- one backend error contract
- no more mixed `{ error }` / `{ status, message }` / ad-hoc SSE payloads

### 2. Standardize frontend error parsing

- update `frontend/src/lib/api/backendClient.ts` to parse the shared backend error shape
- preserve:
  - message
  - status code
  - type / code
  - details when present
- centralize frontend error normalization instead of repeating `instanceof Error ? ...` in many places

Outcome:

- one frontend parsing path for backend failures
- less duplicated error formatting logic

### 3. Consolidate frontend presentation patterns

- keep two surfaces only:
  - inline error for local form actions
  - dialog for operational/session/test failures
- review:
  - `LmConnections.svelte`
  - `McpProfiles.svelte`
  - `ModelConfigs.svelte`
  - `sessionStore.ts`
  - `ErrorDialog.svelte`
- make sure similar failures are shown the same way in similar contexts

Outcome:

- fewer ad-hoc patterns
- clearer distinction between local form validation/action errors and wider operational failures

### 4. Remove silent failure swallowing

- audit `.catch(() => undefined)` and similar patterns
- replace them with one of:
  - visible user error
  - explicit warning/logging
  - intentional documented ignore when the failure is truly harmless

Priority target:

- `frontend/src/lib/sessionStore.ts`

Outcome:

- failures stop disappearing
- recovery behavior becomes explicit

### 5. Fix session creation / initialization recovery

- run pre-flight checks before creating a session:
  - verify model is reachable
  - verify MCP server is reachable (if configured)
- only create the session if pre-flight passes
- if pre-flight fails, surface the failure inline in the new session form and let the user adjust configuration — do not create the session
- if initialization somehow still fails after creation (unexpected runtime error), surface the error clearly and do not leave the session in a silent broken state

Outcome:

- no partially-initialized sessions in the list
- user always has a clear path: adjust config and try again

### 6. Improve connection test reporting

- use a dedicated result dialog for MCP and LM Studio tests
- report:
  - target tested
  - result kind
  - status code if any
  - raw message
  - raw payload/details if available
- classify a few broad categories only:
  - timeout
  - unreachable
  - upstream/server error
  - invalid response
  - unexpected error

Outcome:

- operational tests become useful diagnostics instead of generic pass/fail messages

## Suggested order

1. backend error contract
2. frontend error parsing/normalization
3. remove silent catches
4. session creation/init recovery (pre-flight, no-create-on-failure)
5. connection test dialog/reporting
6. contextual logging pass and cleanup

## Non-goals

- no fancy retry orchestration
- no speculative recovery logic
- no attempt to map every upstream failure to a custom UX
- no hiding raw failures behind overly friendly summaries
- model load/unload recovery flow — separate backlog item
- MCP tool definition drift detection — separate backlog item

## Expected result

After this work:

- backend and frontend speak a consistent error language
- the user sees the actual failure with the raw information available
- common failure paths are recoverable
- session/chat/config screens fail in predictable ways
- the codebase has fewer duplicated error patterns and fewer silent failures
