# Testing

## Commands

- `npm test` — deterministic local backend tests
- `npm run check:backend` — backend type-check
- `npm run test:integration` — live LM Studio + MCP validation

## Current test layers

### 1. Pure logic tests

Fast deterministic coverage for:

- token accounting
- selectors / context reconstruction
- LM Studio SSE parsing

These stay small and exact.

### 2. Focused runtime/app tests

Deterministic tests around the backend runtime and API surface:

- model-only turns
- tool-enabled turns
- session / transcript / context / trace endpoints
- edge-case orchestration that is easier to express directly than as a full trace fixture

Keep these few and surgical.

### 3. Trace replay tests

This is now the main regression path for backend workflow behavior.

The backend exports a full trace at:

- `GET /api/sessions/:sessionId/trace`

The trace bundle includes:

- `session`
- `turns`
- `rounds`
- `parts`
- `rawExchanges`
- `transcript`
- `context`

`rawExchanges` now includes:

- streamed LM request/response payloads
- LM prompt-probe request/response payloads
- MCP request/response payloads, headers, and raw response text

`backend/src/testing/replayHarness.ts` replays one of these bundles through fake user / LM / MCP gateways and compares the replayed trace to the original normalized trace.

Use replay tests whenever behavior spans:

- user input
- LM requests or probes
- MCP initialization / tools
- persisted turns / rounds / parts

### 4. Live integration tests

These remain thin and intentionally few.

Purpose:

- validate the real LM Studio + MCP path
- capture real traces
- detect protocol drift or unexpected live behavior

Live runtime integration now saves the exported trace bundle to `backend-data/test-artifacts/`.

## How to add a regression

1. Reproduce the behavior in a live integration run or deterministic backend run.
2. Export the session trace from `/api/sessions/:sessionId/trace`.
3. Add a local replay test that feeds that trace bundle to the replay harness.
4. Add a separate pure or focused runtime test only if a smaller direct assertion is clearer.

## What we keep

- pure logic tests
- a small number of focused runtime/app tests
- trace replay tests
- a thin live integration layer

## What we avoid

- UI-heavy tests for backend logic
- duplicate transcript/context fixtures when trace already contains them
- regression tests that reconstruct missing payloads instead of replaying recorded traces

## Rule of thumb

If a bug is about backend conversation flow, token attribution, reasoning retention, tool orchestration, or persistence, prefer:

**record trace -> replay trace -> compare trace**
