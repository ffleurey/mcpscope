# Pre-extension runtime generalization

This task defines the cleanup and refactoring work that should land **before** mcpscope extends the data model toward broader workflow-style session types.

It is intentionally narrow. The goal is to harden the current runtime boundaries without yet adding deterministic workflow turns or a more general agent-runtime model.

## Why this task exists

mcpscope no longer has just one simple session data structure.

It already has:

- persisted `session_type`, `parent_kind`, and `parent_id`
- internal analysis child sessions
- parent/child list behavior
- compaction and context bookkeeping
- transport diagnostics embedded in runtime records

That means the project is already partway from "single chat-session model" toward "small runtime framework".

Before adding more session types or broader workflow semantics, the current foundation should be cleaned up so new behavior does not accumulate on top of avoidable structural debt.

## Goal

Create a cleaner runtime foundation for future session-type expansion by:

1. making typed-session creation a first-class invariant
2. clarifying what belongs to session metadata vs runtime execution vs transport diagnostics
3. removing the current "create primary then patch to child type" pattern
4. keeping the runtime tree intact while documenting its current chat-centered boundary accurately

## Fixed decisions for this increment

- use **one unified validated `createSession(...)` path** for primary and non-primary sessions
- keep this increment **strictly pre-extension**; do not redesign the runtime taxonomy here
- keep parent-link hardening at the **application-validation** layer for now

## Scope

### 1. Session creation cleanup

- widen the backend-owned session creation path so it accepts validated session metadata up front:
  - `sessionType`
  - `parentKind`
  - `parentId`
- default omitted metadata to `primary` plus null parent so ordinary creation behavior stays unchanged
- remove the pattern where `createSession(...)` always creates a `primary` session and callers mutate the record afterward
- migrate the analysis-launch flow to the new creation path

### 2. Runtime-boundary clarification

- document and encode the distinction between:
  - session metadata and ownership
  - canonical runtime execution records
  - provider/transport diagnostic payloads
- keep the current runtime tree intact:
  - `SessionRecord`
  - `TurnRecord`
  - `RoundRecord`
  - `PartRecord`
  - `RawExchangeRecord`
- do not add new workflow runtime entities in this increment

### 3. Parent-link hardening at the application boundary

- keep the current v1 parent model:
  - parent kinds limited to `session` and `benchmark`
  - no `turn` parents
- ensure the same validation rules are enforced consistently through one shared code path for:
  - create
  - update
  - trace import normalization
  - analysis-session launch
- make current deletion/query behavior explicit in code comments and canonical docs

### 4. Documentation alignment

- keep canonical docs accurate about what is already implemented today
- explicitly state what remains future work:
  - broader workflow/runtime generalization
  - deterministic non-LLM step modeling inside a session
  - richer parent object support

## Non-goals

- no new session type in this increment
- no deterministic workflow-turn model yet
- no change to the canonical session/setup/turn/round/part tree yet
- no benchmark object design
- no database-level polymorphic parent foreign key system
- no frontend tree redesign
- no new CLI or MCP feature surface beyond small consistency wiring if needed

## Implementation notes

### Preferred construction shape

Keep one `createSession(...)` entry point and widen its input to include session metadata fields.

Expected behavior:

- if session metadata is omitted, creation behaves exactly like today's primary-session flow
- if session metadata is supplied, it is validated before persistence and survives the whole creation path without post-create patching

### Runtime-model caution

This increment should **not** try to solve the later question of whether mcpscope sessions become a more general substrate for deterministic workflow steps.

It should only make that later step easier by reducing hidden assumptions in creation and orchestration paths.

## Acceptance criteria

1. There is one validated backend-owned creation path for both primary and non-primary sessions.
2. The analysis launch flow no longer creates a primary session and patches it afterward.
3. Existing session-metadata behavior remains intact:
   - primary-only default list behavior
   - child lookup
   - recursive delete for session-parent trees
   - existing analysis child-session flow
4. Canonical docs no longer claim that session typing/parent links are unimplemented.
5. The implementation makes the current architectural boundary explicit: typed sessions exist, but deterministic workflow/runtime generalization does not yet.

## Validation

Required validation path:

- `npm test -- backend/src/sessionMetadata.test.ts`
- `npm test -- backend/src/app.test.ts -t "analysis launch"`
- `npm run check:backend`

## Likely touch points

- `backend/src/domain/model.ts`
- `backend/src/domain/sessionValidation.ts`
- `backend/src/runtime/modelTurns.ts`
- `backend/src/operations/launchAnalysis.ts`
- `backend/src/runtime/traceImport.ts`
- `backend/src/persistence/repository.ts`
- `DATA-MODEL.md`
- `ARCHITECTURE.md`

## Dependencies

- [backlog/completed/session-metadata-foundation.md](backlog/completed/session-metadata-foundation.md)
- [backlog/completed/session-analysis-launch-and-report.md](backlog/completed/session-analysis-launch-and-report.md)
- [backlog/specification/session-analysis-agent.md](backlog/specification/session-analysis-agent.md)

## Expected result

After this increment:

- typed sessions are created through one consistent validated path
- analysis child sessions no longer rely on post-create metadata patching
- the current runtime model remains intact but its boundaries are clearer
- the codebase is in a safer position for later work on richer session types or session-backed workflow experiments