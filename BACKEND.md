# Backend-First Refactoring Plan

## Decision

The project should pivot from a pure frontend architecture to a **local backend + frontend UI** architecture.

This does **not** change the product identity:

- still local-first
- still single-user
- still optimized for experimentation, observability, and MCP evaluation
- still simple and minimal

What changes is where the hard logic lives.

The backend should become the canonical owner of:

- session runtime orchestration
- LM Studio integration
- MCP integration
- token accounting
- reasoning retention / context inclusion rules
- persistence
- exports and diagnostics

The frontend should become mostly a presentation layer.

## Why this pivot is worth it

The current frontend-only design made sense for early speed, but it now creates structural friction:

- browser CORS constraints shape backend integration choices
- protocol logic and UI state are mixed together
- IndexedDB and frontend stores are carrying too much responsibility
- the token/context logic is hard to isolate and test
- runtime orchestration is happening inside UI-oriented code

The product has evolved into a **local orchestration and inspection tool**, not just a browser UI. The architecture should match that.

## Architecture goals

1. Move all non-visual logic to the backend.
2. Keep the frontend thin and replaceable.
3. Define one canonical backend domain model for content, context, and token provenance.
4. Make the backend executable and testable without the UI.
5. Keep deployment local and simple: one frontend, one local backend process.
6. Avoid unnecessary infrastructure, distributed systems ideas, or enterprise patterns.

## Proposed stack

### Backend

- **Runtime:** Node.js
- **Language:** TypeScript
- **HTTP server:** **Fastify**
- **Validation / schemas:** `zod`
- **Persistence:** **SQLite**
- **SQLite driver:** **better-sqlite3**
- **MCP client:** `@modelcontextprotocol/sdk`
- **LM Studio integration:** native `fetch`
- **Testing:** **Vitest**

### Frontend

- keep **Svelte + Vite + TypeScript**
- remove business logic from stores
- keep only UI state, rendering, and user interactions

## Why this stack

### Fastify

Fastify is a good fit because it is:

- minimal
- fast enough
- TypeScript-friendly
- stable
- easy to structure without adding too much framework machinery

Express would also work, but Fastify gives cleaner typing and a better default foundation without becoming heavy.

### SQLite + better-sqlite3

SQLite is the right persistence choice here:

- local
- single-user
- easy to inspect and back up
- more reliable and queryable than IndexedDB for this kind of runtime state

`better-sqlite3` keeps the implementation simple. This project does not need distributed storage, async database infrastructure, or a heavy ORM.

### No ORM initially

Do **not** start with an ORM unless schema evolution becomes painful.

For the first backend version:

- keep schema explicit
- write SQL directly
- keep the data model close to the domain

If migrations later become complex, add a lightweight migration tool, but do not front-load that complexity.

### Vitest

Vitest remains the right test framework for both backend domain logic and frontend-adjacent TypeScript tests.

It should become the standard baseline for:

- pure logic tests
- backend integration tests
- repository-level regression tests

## High-level target architecture

### Backend responsibilities

The backend owns:

1. **Session lifecycle**
   - create session
   - load session
   - delete session
   - export session

2. **Turn orchestration**
   - receive user prompt
   - construct model-visible payload
   - stream LM Studio response
   - accumulate reasoning/content/tool calls
   - execute tool rounds
   - finalize usage and provenance

3. **Canonical state model**
   - session metadata
   - turns
   - rounds
   - parts
   - token provenance
   - context membership state

4. **Integrations**
   - LM Studio
   - MCP server(s)

5. **Diagnostics**
   - exact payload reconstruction
   - trace capture
   - context view derivation
   - export generation

6. **Persistence**
   - SQLite schema
   - load/save/query
   - migration path from current frontend persistence

### Frontend responsibilities

The frontend owns:

1. rendering the transcript
2. rendering tool traces
3. rendering the context bar
4. rendering forms and settings
5. displaying stream events from the backend
6. initiating user actions

It should **not** own:

- token accounting
- context policy
- LM Studio request construction
- MCP protocol handling
- persistence logic
- the tool execution loop

## Canonical backend domain model

The backend should define a single domain model that answers three questions from the same source:

1. What did the user see?
2. What did the model see?
3. What did we measure?

### Recommended entities

#### `Session`

- id
- title
- status
- createdAt / updatedAt
- model profile snapshot
- MCP profile snapshot
- initialization status
- context window metadata

#### `Turn`

- id
- sessionId
- sequence number
- status
- createdAt / completedAt
- turn summary usage
- final outcome

A turn represents one user input and the assistant work that follows.

#### `Round`

- id
- turnId
- index
- request metadata
- finish reason
- prompt/completion/reasoning usage
- startedAt / completedAt

A round is one LLM call within a turn.

#### `Part`

A part is the central building block.

Examples:

- system prompt block
- MCP instructions block
- tool definitions block
- user message block
- assistant reasoning block
- assistant content block
- tool call block
- tool result block

Each part should carry:

- content payload
- structural type
- display metadata
- context metadata
- token metadata
- provenance metadata
- links to session / turn / round / parent part where relevant

### Required metadata on each part

#### Display metadata

- visible in transcript
- collapsed by default or not
- diagnostic-only or user-facing

#### Context metadata

- included in current request
- excluded
- stripped from historical context
- historical-only
- included only within live multi-round execution

#### Token metadata

- token amount
- source
  - exact API
  - delta-derived
  - corrected
  - estimated
  - unknown
- confidence
  - exact
  - corrected
  - estimated
  - unknown
- explanation / provenance note

This is the critical design rule: **token information lives next to the content it describes**.

## Runtime flow after the pivot

### 1. Session initialization

Backend actions:

- load model and MCP profile snapshots
- probe model metadata if needed
- initialize MCP connection if configured
- compute or store initial session-level prompt/tool metadata

Frontend only shows progress/result.

### 2. Sending a user message

Backend actions:

- create a new turn
- create the user part
- build the first request payload from canonical state
- stream LM Studio output

### 3. Streaming assistant output

Backend actions:

- accumulate assistant reasoning/content into round output
- create/update assistant parts
- emit stream events to frontend

Frontend actions:

- render stream incrementally

### 4. Tool round handling

Backend actions:

- collect tool calls
- persist tool-call parts
- execute MCP tools
- persist tool-result parts
- decide whether another round is needed

### 5. Turn finalization

Backend actions:

- finalize usage
- finalize token provenance
- finalize context membership state
- persist the canonical turn state
- derive context read model

### 6. Later historical reconstruction

Backend actions:

- rebuild exact model-visible payload from stored parts
- expose transcript view and context view as derived models

The frontend should never have to reverse-engineer this.

## Backend API shape

Keep the API small and local-focused.

### Configuration endpoints

- `GET /api/config/models`
- `POST /api/config/models`
- `PUT /api/config/models/:id`
- `DELETE /api/config/models/:id`

- `GET /api/config/mcp-servers`
- `POST /api/config/mcp-servers`
- `PUT /api/config/mcp-servers/:id`
- `DELETE /api/config/mcp-servers/:id`

### Session endpoints

- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `POST /api/sessions/:id/export`

### Turn endpoints

- `POST /api/sessions/:id/turns`
- `GET /api/sessions/:id/turns`
- `GET /api/turns/:id`

### Derived read-model endpoints

- `GET /api/sessions/:id/transcript`
- `GET /api/sessions/:id/context`
- `GET /api/sessions/:id/trace`

### Streaming

For simplicity, start with:

- `POST /api/sessions/:id/turns` returning a **streaming HTTP response**

The frontend can consume the stream using `fetch()` and a readable stream.

Do **not** add WebSockets unless there is a clear need later.

## Persistence plan

Move from IndexedDB to SQLite.

### Why

- backend-owned truth
- easier testing
- easier inspection
- easier exporting
- easier data migrations
- clearer relational links between sessions, turns, rounds, and parts

### Suggested schema areas

- `model_profiles`
- `mcp_profiles`
- `sessions`
- `turns`
- `rounds`
- `parts`
- `tool_calls` or tool-specific part metadata tables if needed
- `raw_exchanges`

The exact table split can be refined later, but the schema should preserve:

- sequence and hierarchy
- provenance
- timestamps
- token metadata
- context inclusion state

## Migration strategy

This should happen in phases, not as one big rewrite.

### Phase 1: Backend foundation

- create backend workspace
- choose directory structure
- add Fastify, SQLite, Vitest
- define domain types
- define database schema

### Phase 2: Backend canonical model

- implement session / turn / round / part model
- implement pure logic for:
  - payload reconstruction
  - reasoning/context policy
  - token provenance
  - derived context view

No frontend changes beyond temporary wiring yet.

### Phase 3: Backend runtime pipeline

- move LM Studio integration to backend
- move MCP integration to backend
- implement turn orchestration pipeline
- stream events/results to frontend

### Phase 4: Frontend slimming

- replace frontend runtime logic with API calls
- reduce stores to UI state only
- remove token/context computations from the frontend
- keep renderers and forms

### Phase 5: Persistence cutover

- stop writing runtime data to IndexedDB
- store canonical runtime state in SQLite
- optionally keep local frontend preferences separately if still useful

### Phase 6: Cleanup

- remove duplicated frontend runtime logic
- remove dead IndexedDB paths
- simplify chat stores
- simplify MCP and LM Studio service code in the frontend

## Proposed repo structure

Keep this simple and explicit.

Recommended direction:

```text
/src                  # frontend UI
/backend
  /src
    /api
    /domain
    /services
    /persistence
    /runtime
    /testing
```

Possible backend internal structure:

- `domain/`
  - core types
  - invariants
  - selectors
- `runtime/`
  - turn pipeline
  - streaming orchestration
- `services/`
  - lmstudio client
  - mcp client
- `persistence/`
  - sqlite connection
  - repositories
  - migrations
- `api/`
  - Fastify routes
  - request/response schemas

## Testing implications

This pivot should make testing easier, not harder.

### Backend tests

Priority suites:

1. token provenance rules
2. reasoning retention vs context inclusion
3. payload reconstruction
4. multi-round tool execution flow
5. context read-model derivation
6. persistence round-trips

### Frontend tests

Keep them lighter:

- rendering of transcript blocks
- rendering of context bar from backend read model
- interaction tests for forms and controls only where needed

The backend should carry the trust-critical tests.

## Risks and tradeoffs

### Costs

- architecture migration cost
- extra process to run locally
- need to define and maintain a backend API

### Benefits

- much better separation of concerns
- easier automated testing
- easier protocol handling
- easier persistence and export logic
- removes browser/CORS as the architectural driver
- backend can be run headlessly for tests and diagnostics

For this project, the benefits outweigh the costs.

## What not to do

- do not build a remote/cloud service
- do not overengineer auth or multi-user concerns
- do not introduce queues, workers, or distributed messaging
- do not add GraphQL
- do not add WebSockets unless streaming over fetch proves insufficient
- do not add an ORM before the schema settles
- do not keep business logic duplicated in frontend and backend

## New sequencing recommendation

The project should now proceed in this order:

1. backend architecture and domain model
2. backend persistence and runtime pipeline
3. backend tests for token/context/runtime correctness
4. frontend simplification to consume backend read models and streams
5. cleanup of old frontend-only runtime logic
6. only then resume product feature work

## Acceptance criteria for the pivot

The backend-first refactor is successful when:

1. the backend can run the full chat/tool loop without the frontend
2. the backend owns the canonical session/turn/part state
3. token provenance is stored on canonical content blocks
4. reasoning is preserved while context inclusion is explicitly modeled
5. the frontend renders backend-derived transcript and context views
6. runtime behavior is covered by automated backend tests
7. the browser is no longer directly responsible for LM Studio and MCP protocol orchestration

## Recommendation

Proceed with the backend/frontend split before deepening the current frontend runtime refactor.

The refactoring and testing work already identified still matters, but it should now happen with the **backend as the architectural center**.
