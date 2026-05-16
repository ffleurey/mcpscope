# Testing

## Commands

- `npm test` — deterministic local tests (pure logic, runtime, app, replay)
- `npm run check` — svelte-check + frontend TypeScript
- `npm run check:backend` — backend TypeScript check
- `npm run test:integration` — live LM Studio + MCP validation (requires running LM Studio + MCP server)

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

The hierarchical lookup regression in `backend/src/app.test.ts` also regenerates inspectable payload artifacts in `test-results/` on each run:

- `test-results/lookup-api-payload-audit.md`
- `test-results/lookup-api-payload-audit.json`

These are intended for payload-contract review while iterating on the lookup API.

The backend API reference at `/reference/` also reads those lookup audit artifacts to populate real OpenAPI examples for the lookup endpoint.

To refresh those examples after changing the lookup contract, run:

```bash
npm test -- backend/src/app.test.ts -t "returns expected lookup payloads for session/turn/round/part on exported multi-turn tool baseline"
```

That command rewrites the audit files in `test-results/`, and `/reference/` will then show the updated examples on the next backend reload.

### 3. Trace replay tests

This is the main regression path for backend workflow behavior.

The backend exports a full trace at `GET /api/sessions/:sessionId/trace`. See [ARCHITECTURE.md](ARCHITECTURE.md) for the trace bundle shape and vocabulary.

`rawExchanges` includes:

- streamed LM request/response payloads
- LM prompt-probe request/response payloads
- MCP request/response payloads, headers, and raw response text

`backend/src/testing/replayHarness.ts` replays a trace bundle through fake user / LM / MCP gateways and compares the replayed trace to the original normalized trace.

Use replay tests whenever the behavior under test spans:

- user input
- LM requests or probes
- MCP initialization / tools
- persisted turns / rounds / parts

Replay fixtures and most deterministic tests operate on committed **parts**, not transient streaming **deltas**.

### 4. Live integration tests

These remain thin and intentionally few.

Purpose:

- validate the real LM Studio + MCP path
- capture real traces
- detect protocol drift or unexpected live behavior

Live runtime integration now saves the exported trace bundle to `backend-data/test-artifacts/`.

`backend-data/README.md` documents what belongs in that folder, how to regenerate it, and which captures are intentionally kept.

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
