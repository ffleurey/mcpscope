# Current roadmap

## Status summary

The first backend increment is complete. The project now has a backend runtime foundation strong enough to build on.

## Completed

### 1. Backend runtime foundation

- Fastify + TypeScript backend added in-repo
- SQLite persistence established
- canonical runtime model implemented
- LM Studio and MCP integrations wired through the backend

### 2. Trustworthy runtime capture

- streamed reasoning/content/tool-call capture implemented
- reasoning retained in transcript but stripped from later context
- prompt-token probes persisted as raw exchanges
- full trace export added at `/api/sessions/:sessionId/trace`

### 3. Testing foundation

- local unit/runtime/app coverage in place
- live integration suite stabilized
- exported traces can now be replayed through a deterministic harness
- testing documentation updated around replay-first regression strategy

## Next

### 4. Frontend rewiring

Goal: make the frontend a thin client over the backend.

Work:

- replace remaining frontend-owned runtime logic with backend API usage
- render transcript/context/diagnostic state from backend responses
- expose trace export/import cleanly in the UI
- standardize the frontend/backend contract on **Turn -> Round -> Part -> Delta**
- use streamed deltas only for live updates, then replace them with committed backend parts
- use **SSE** for backend-to-frontend live streaming
- keep `GET /api/sessions/:sessionId/trace` as the canonical detailed payload
- add `GET /api/sessions` for lightweight sidebar summaries
- import traces into backend persistence so imported sessions and live sessions share the same UI path
- remove stale frontend-only data paths

### 5. Step-by-step execution plan

This is the active implementation order for the remaining frontend/backend architecture refactor.

#### Step 1. Complete the backend list/profile/import API

Do this before frontend rewiring so the frontend has a stable contract to target.

Deliver:

- `GET /api/sessions` for lightweight sidebar summaries
- `DELETE /api/sessions/:sessionId`
- backend-owned CRUD for LM connections, model profiles, and MCP profiles
- trace import endpoint(s) that persist imported traces as normal backend sessions

Tests:

- app tests for success and error cases
- persistence tests for list, delete, and import behavior
- trace import/export round-trip checks where practical

#### Step 2. Add backend streaming API

Do this on top of the same trace contract, not as a second model.

Deliver:

- SSE streaming endpoint for turn execution
- backend-native event vocabulary built on `Turn -> Round -> Part -> Delta`
- transient delta events followed by committed part events

Recommended event set:

1. `turn-started`
2. `round-started`
3. `part-delta`
4. `part-committed`
5. `round-committed`
6. `turn-committed`
7. `turn-failed`

Tests:

- event ordering
- event payload shape
- reasoning/content/tool-call streaming behavior
- rule that deltas are transient and committed parts are canonical

#### Step 3. Build the new frontend data layer

Only after the backend contract is stable enough.

Deliver:

- typed backend API client under `src/lib/api/`
- backend payload types aligned with backend responses
- new session store driven by backend session summaries and trace payloads
- no frontend persistence, no cache, no parallel chat runtime model

Tests:

- frontend store tests against mocked backend responses
- import-driven tests using captured traces where helpful

#### Step 4. Rewire the UI onto backend data

Migrate view by view instead of mixing old and new runtime logic.

Deliver:

- sidebar driven by `GET /api/sessions`
- chat transcript driven by trace `transcript`
- context bar driven by trace `context`
- debug/raw panels driven by `parts` and `rawExchanges`
- turn submission via `POST /turns`, then later via SSE streaming

Tests:

- component tests around rendering backend payloads
- trace-based UI tests for reasoning/tool-call ordering and context display

#### Step 5. Add trace import/export UI

Deliver:

- export current session trace
- import a trace and open it through the same backend/session path as live data

Tests:

- import flow tests
- rendering tests for imported sessions

#### Step 6. Remove the legacy frontend runtime

Do this only after the backend-driven path is complete.

Deliver:

- remove `src/lib/chatStore.ts`
- remove `src/lib/db.ts`
- remove browser-side LM Studio and MCP runtime logic
- trim obsolete frontend-only types and compatibility code

Tests:

- final frontend smoke coverage on the new data layer
- backend/frontend integration checks on the stable API contract

### 6. Frontend cleanup and UX

Goal: make the UI fit the backend-native workflow.

Work:

- simplify state management around sessions and turns
- make trace inspection/export easier to use
- polish presentation for MCP debugging and data-analysis use cases

## Guiding constraints

- backend remains the runtime source of truth
- SQLite remains the canonical store
- trace export must stay replayable without reconstruction
- reasoning stays preserved in history even when stripped from later context
- vocabulary stays standardized as **Turn -> Round -> Part -> Delta**
- the frontend may render transient deltas, but canonical state always comes from committed backend parts

## Active planning file

`PLAN.md` is the active roadmap for the remaining architecture refactor.

`REFACTORING.md` is now historical context and closure for the completed backend-first refactor. It should not carry the active step-by-step implementation plan.
