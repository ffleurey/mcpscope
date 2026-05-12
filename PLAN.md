# Current roadmap

## Status summary

The backend-first rewrite is now far enough along to treat the project as a **first MVP candidate**.

What is already in place:

- backend-owned runtime, persistence, and profile management
- backend SSE streaming on the canonical trace contract
- backend-driven frontend sessions, trace loading, streaming submission, import/export, compact chat mode, and inspect mode

What still blocks calling it a trustworthy finished tool:

- the **legacy frontend runtime is still present in the tree**
- token counting and context bar visualization are not yet fully verified/hardened

The immediate recommendation is to **finish the refactor boundary first** by removing the leftover frontend-owned runtime path, then return to token/context trust work on top of that simplified architecture.

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

**Status:** Completed

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

**Status:** Completed

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

Current implementation note:

- the backend now exposes the SSE endpoint and emits canonical `turn-started`, `round-started`, `part-delta`, `part-committed`, `round-committed`, `turn-committed`, and `turn-failed` events
- local backend tests cover model-only and tool-enabled SSE event ordering and canonical replacement behavior
- next work moves to the frontend data layer rather than expanding backend protocol shape further

#### Step 3. Build the new frontend data layer

Only after the backend contract is stable enough.

**Status:** Completed

Deliver:

- typed backend API client under `src/lib/api/`
- backend payload types aligned with backend responses
- new session store driven by backend session summaries and trace payloads
- no frontend persistence, no cache, no parallel chat runtime model

Tests:

- validate the frontend against the real backend app rather than mocked backend contracts
- keep captured traces available for import-driven UI inspection

Current implementation note:

- typed backend API helpers now live under `src/lib/api/`
- backend payload types now live under `src/lib/backendTypes.ts`
- `connectionStore` now loads and saves backend-owned LM connections, model configs, and MCP profiles through backend CRUD endpoints
- `sessionStore` now drives session summaries, active trace loading, trace export, and non-streaming turn submission
- the frontend no longer depends on IndexedDB for active session/runtime state

#### Step 4. Rewire the UI onto backend data

Migrate view by view instead of mixing old and new runtime logic.

**Status:** MVP-level implementation completed

Deliver:

- sidebar driven by `GET /api/sessions`
- chat transcript driven by trace `transcript`
- context bar driven by trace `context`
- debug/raw panels driven by `parts` and `rawExchanges`
- turn submission via `POST /turns`, then later via SSE streaming

Tests:

- validate the rewired views against the real backend app
- use imported captured sessions for trace-based UI inspection

Current implementation note:

- the sidebar now reads backend session summaries
- the chat view now defaults to a much more compact Zed-inspired chat surface, while inspect mode keeps the richer trace hierarchy
- raw payload access now lives inline at the round level for request / response / raw exchanges
- session-level setup parts remain visible without introducing a separate inspector workflow
- the context bar now renders backend `context`
- compact chat streaming now has better phase handoff behavior for reasoning / tool activity / assistant content
- compact chat spacing and density were tightened enough for ongoing MVP use, even if more polish may still come later

#### Step 5. Add trace import/export UI and live updates

**Status:** Completed

Deliver:

- export current session trace
- import a trace and open it through the same backend/session path as live data
- add SSE-driven live updates on top of the same trace contract

Tests:

- import flow tests
- rendering tests for imported sessions

Current implementation note:

- the rewired frontend now submits turns through the backend SSE path and renders transient round deltas inline before committed parts replace them
- live delta state is updated immutably so streamed content keeps growing in real time rather than stalling after the first fragment
- active streaming now also keeps the transcript pinned to the bottom so live output remains visible without manual scrolling
- export is available from the active session header
- trace import is available from the sessions sidebar and opens imported traces through the same backend/session path as live sessions
- committed `turn-committed` traces still replace the live overlay so the backend trace remains canonical

#### Step 6. Remove the legacy frontend runtime

Do this only after the backend-driven path is complete.

**Status:** Next active refactor step

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
- keep trace inspection embedded in the main session view and reserve export for full-trace JSON
- polish presentation for MCP debugging and data-analysis use cases

## After refactor boundary is complete

Once the legacy frontend runtime is removed, return to the remaining trust work:

1. harden token counting end-to-end against captured traces and live sessions
2. verify that the context bar is driven by the same canonical token/context data as the rest of the trace
3. fix any remaining context/token mismatches only after the architecture no longer mixes old and new runtime paths

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
