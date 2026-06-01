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

## Analysis workflow checks

The recovered `session_analysis` workflow has one focused backend regression that should stay
green when changing analysis evidence loading or context mutation:

```bash
npx vitest run backend/src/app.test.ts -t "v2 full flow with tool calls: produces assessment, turn_summary, and final_report artifacts via deterministic inspect turns" --reporter=dot
```

Use that test before widening to a broader suite when the change is specifically about:

- deterministic inspect evidence loading
- packet-local context mutation
- analysis artifacts and summary generation
- reasoning slices around analyzed tool calls

## Scheduler execution checks

Use this focused scheduler slice when the change touches queue semantics, analysis stepping, or pause-at-boundary behavior:

```bash
npx vitest run backend/src/app.test.ts -t "single-step execute|pause stops analysis session execution" --reporter=dot
```

That slice should stay green when changing:

- scheduler pause or resume semantics
- session-target execution boundaries
- analysis single-step execution
- `/api/sessions/:sessionId/execute` compatibility behavior

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
