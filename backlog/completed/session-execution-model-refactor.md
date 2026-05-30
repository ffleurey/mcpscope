# Session execution model refactor

This task defines the implementation plan for refactoring mcpscope from the current chat-centered runtime model to the specified session-backed execution model.

It is intentionally implementation-oriented. The target design and fixed architectural decisions live in [backlog/completed/session-backed-deterministic-harness-data-model.md](backlog/completed/session-backed-deterministic-harness-data-model.md).

## Why this task exists

mcpscope already has multiple signs that the runtime is growing beyond one simple chat-session record shape:

- persisted typed sessions and parent links
- child-session behavior
- compaction and context bookkeeping
- thin adapters over backend-owned operations
- a need for clearer boundaries before broader workflow/session extension

The agreed target is now clearer:

- `Session` is the execution container
- `Step` is the abstract execution unit
- `Turn` is the LLM-specific step subtype
- `Session.execute()` runs the full loop by repeatedly calling `advance()` while `canContinue()` is true
- `SessionContainer` is the domain ownership abstraction
- persistence is generic by default for containers, sessions, and steps
- `Benchmark` should be introduced now as a minimal container concept

The work is still a refactor, not a product rewrite. The implementation must preserve current behavior across backend, HTTP/API, CLI, MCP, and UI while moving the codebase onto the new model.

## Goal

Refactor the backend runtime, persistence layer, and adapters so current mcpscope behavior runs on top of the new execution model and persistence contract, while keeping the rollout safe and incremental.

## Fixed decisions for this increment

- treat this increment as a parity-preserving refactor
- keep current user-visible behavior working unless a change is explicitly part of the task
- introduce `SessionContainer`, `Session`, `Step`, and `Turn` as the canonical domain vocabulary
- model session ownership through `SessionContainer`, not a persistence-shaped parent-reference object
- include a minimal `Benchmark` container in the overhaul
- keep persistence generic by default for containers, sessions, and steps
- allow subtype-specific persistence only for infrastructure-relevant cases, with `Turn` as the initial example
- keep artifact polymorphism based on content type, not workflow-semantic subtype tables
- use a fresh schema; no database migration compatibility is required for this increment

## Scope

### In scope

- new domain model for containers, sessions, steps, turns, context, and artifacts
- fresh persistence schema matching the new model
- generic container/session/step persistence mapping contract
- LLM-specific persistence for turns, rounds, parts, and raw exchanges
- backend operation refactor so existing behavior runs through the new model
- CLI, MCP, and UI parity on top of the refactored backend
- focused documentation updates needed to keep canonical docs aligned
- regression coverage for the refactor path

### Out of scope

- adding new end-user workflow features beyond the current behavior envelope
- full benchmark-domain design beyond minimal container support
- plugin packaging or extension API design
- broad UI redesign
- final workflow-specific semantic schemas for future artifacts

## Step-by-step implementation plan

The implementation should proceed in the following order. Each step is intended to leave the branch in a coherent, testable state.

### Step 1. Introduce the new domain vocabulary without changing product behavior

Goal:

- create the domain-level types and interfaces that the later refactor will target

Work:

- add the new abstract domain concepts:
  - `SessionContainer`
  - `Session`
  - `Step`
  - `Turn`
  - `VisibleContext`
  - content-type-oriented `Artifact` hierarchy
- define the generic type-key and payload concepts for containers, sessions, and steps
- keep current API contracts and current behavior unchanged at this step
- do not switch persistence yet

Important note:

- this step is about introducing the target concepts and mapping boundaries, not yet replacing the existing runtime execution code

Exit criteria:

- the new domain vocabulary exists in code
- there is a clear mapping boundary between old record shapes and new domain concepts
- existing behavior remains unchanged

Gate before Step 2:

- confirm the new domain vocabulary is coherent and not leaking persistence-first concepts
- run focused validation for the touched domain/types slice
- stop and reassess if the mapping boundary is still unclear or if the new vocabulary is already forcing broad behavior changes

### Step 2. Introduce the generic persistence contract

Goal:

- define how the new domain model persists without creating subtype tables for every concrete session or step class

Work:

- design and implement generic persistence records for:
  - containers
  - sessions
  - steps
- store type keys plus generic parameter/state/input/output payloads
- define where `Turn` requires dedicated persistence because it owns rounds, parts, and raw exchanges
- define how minimal benchmark-container persistence fits into the same model
- keep old runtime behavior active while this persistence layer is introduced

Exit criteria:

- generic persistence types and repository boundaries are present
- the schema shape for generic containers/sessions/steps is implemented
- no new workflow-specific session or step subtype table is required by default

Gate before Step 3:

- confirm the generic persistence contract is simple enough to support future extension without table-per-subtype growth
- verify `Turn` remains the only clear infrastructure-driven subtype persistence case at this stage
- stop and reassess if new subtype tables are already appearing for workflow semantics rather than infrastructure needs

### Step 3. Build the fresh schema and repository layer in parallel with the old one

Goal:

- land the new schema and repositories safely before switching behavior over

Work:

- implement the fresh schema for:
  - `session_containers`
  - `sessions`
  - `steps`
  - `turns`
  - `rounds`
  - `parts`
  - `raw_exchanges`
  - context and artifact tables
- implement repositories/mappers that read and write the new schema
- keep the repository API backend-owned and adapter-agnostic
- avoid mixing transport-specific semantics into persistence or domain objects

Important note:

- no database migration path is required, but the branch should still switch over in controlled code steps rather than as one giant rewrite

Exit criteria:

- the fresh schema initializes successfully
- repository operations for the new model compile and are testable
- current behavior has not yet been broadly rewired to depend on the new repositories unless the touched slice is validated

Gate before Step 4:

- confirm schema and repository boundaries are stable enough to start behavior porting
- run focused validation on schema initialization and repository-level behavior
- stop and reassess if repository APIs are still churning or if adapters would need to guess missing semantics

### Step 4. Port current chat-session behavior onto the new domain model

Goal:

- make today's primary chat/session behavior run through `Session`, `Step`, and `Turn`

Work:

- map current primary-session execution to the new domain model
- make current turn execution run through `Turn` as the LLM-specific `Step`
- preserve current rounds/parts/raw-exchange behavior under the new model
- keep the canonical current behavior of session creation, listing, trace lookup, deletion, and execution

Exit criteria:

- today's normal session behavior runs through the new domain and persistence model
- replayability and inspectability of current turn/round/part behavior still work

Gate before Step 5:

- confirm primary chat behavior is preserved on the new model
- run focused runtime or replay validation for turn/round/part/raw-exchange behavior
- stop and reassess if current chat behavior is not yet stable on the new model

### Step 5. Port typed sessions and ownership to `SessionContainer`

Goal:

- move current typed-session and parent behavior onto the new container model

Work:

- replace persistence-shaped parent metadata as the main domain concept with `SessionContainer`
- make `Session` a `SessionContainer`
- introduce a minimal `Benchmark` container and generic container ownership mapping
- keep current typed-session behavior working:
  - primary sessions
  - analysis child sessions
  - compaction-related session typing behavior if present
- preserve list/query/delete behavior for current session trees

Exit criteria:

- container ownership is modeled in the domain
- current session-parent behavior still works
- benchmark container support exists at the model/persistence level without requiring full benchmark product work

Gate before Step 6:

- confirm `SessionContainer` ownership is clean in the domain and not leaking persistence-shaped parent logic back upward
- validate current typed-session and child-session behavior
- stop and reassess if benchmark support is pushing beyond the agreed minimal container scope

### Step 6. Introduce the execution loop shape

Goal:

- align orchestration code with the new execution model without changing current behavior

Work:

- introduce `Session.execute()`, `Session.advance()`, and `Step.execute(context)` boundaries in runtime code
- keep the current behavior for existing chat-style execution
- ensure the orchestration loop is explicit and testable
- keep future deterministic-step extensibility visible in code shape, but do not broaden the product surface in this step

Exit criteria:

- session execution is structured around `execute()` plus `advance()`
- step execution is structured around `Step.execute(...)`
- current user-visible behavior remains aligned

Gate before Step 7:

- confirm the execution loop boundaries are explicit, testable, and still behaviorally equivalent for current flows
- run focused validation on execution and orchestration behavior
- stop and reassess if the new loop shape changes user-visible behavior or obscures the current trace model

### Step 7. Port backend operations and adapters with parity

Goal:

- keep backend operations as the single source of truth while moving adapters to the new model

Work:

- update backend operations first so HTTP/API, CLI, and MCP continue to reflect the backend-owned operation semantics
- keep machine-readable output shapes stable unless a change is explicitly part of the task
- update CLI adapter behavior against the refactored backend model
- update MCP adapter behavior against the same operations
- keep UI-facing API responses aligned with the existing product behavior

Exit criteria:

- backend operations run on the new model
- CLI and MCP stay aligned through the backend operation layer
- no adapter invents its own runtime semantics

Gate before Step 8:

- confirm backend operations are stable and machine-readable outputs are still aligned
- validate backend plus CLI and MCP parity before touching the frontend
- stop and reassess if adapters have diverged or if API contracts are still shifting

### Step 8. Update the UI to the refactored model while preserving behavior

Goal:

- keep the frontend thin while maintaining current listing and inspection behavior

Work:

- adapt the frontend only after backend contracts are stable for the touched slice
- preserve current session listing, trace inspection, and related current workflows
- avoid pushing runtime ownership or validation into Svelte components

Exit criteria:

- current UI behavior works on top of the refactored backend model
- the frontend remains thin and backend-owned semantics stay in the backend

Gate before Step 9:

- confirm backend, CLI, MCP, and UI parity for the touched behavior surface
- run the relevant frontend and adapter validation before removing fallback code
- stop and reassess if any surface still depends on obsolete v1-only paths

### Step 9. Remove obsolete v1-only code paths and align docs

Goal:

- finish the refactor cleanly once the new path is validated

Work:

- remove superseded v1-only runtime/persistence abstractions that are no longer needed
- update canonical docs where implementation details changed:
  - `DATA-MODEL.md`
  - `ARCHITECTURE.md`
  - possibly `README.md`, `CLI.md`, and `MCP.md` if surface wording changed
- keep docs precise about what is implemented now versus what remains future work

Exit criteria:

- there is one clear runtime/persistence path for the refactored model
- canonical docs match the landed implementation

Final gate before handoff:

- run the full validation required by the touched surfaces
- confirm no obsolete compatibility path is still silently required for current behavior
- summarize any remaining risks or review-sensitive areas before opening or updating the PR

## Acceptance criteria

1. Current functionality continues to work across backend, HTTP/API, CLI, MCP, and UI surfaces.
2. The canonical domain vocabulary is now `SessionContainer`, `Session`, `Step`, and `Turn`.
3. `Session.execute()` runs the full loop by repeatedly calling `advance()` while `canContinue()` is true.
4. The persistence model is generic by default for containers, sessions, and steps.
5. New workflow-specific session and deterministic step types can be added without requiring new persistence tables by default.
6. `Turn`, `Round`, `Part`, and `RawExchange` still support the current LLM execution behavior and inspectability expectations.
7. A minimal `Benchmark` container exists in the model and persistence layer.
8. The implementation lands in validated incremental steps rather than one broad unsafe rewrite.

## Validation

Required validation path during the rollout:

- run focused backend tests after each substantive backend slice
- prefer replay or focused backend tests when orchestration/persistence behavior changes
- run `npm run check:backend` for backend TypeScript changes
- run `npm run check:cli` when CLI code changes
- run `npm run check` when frontend code changes
- run `npm test` before final handoff

Recommended focused validation areas:

- session creation and typed-session ownership behavior
- session listing and trace retrieval
- analysis child-session flows
- delete/query behavior for session-parent trees
- replay-sensitive turn/round/part/raw-exchange behavior
- CLI and MCP parity on top of backend operations

## Likely touch points

- `backend/src/domain/model.ts`
- `backend/src/domain/`
- `backend/src/runtime/modelTurns.ts`
- `backend/src/runtime/traceImport.ts`
- `backend/src/operations/`
- `backend/src/persistence/schema.ts`
- `backend/src/persistence/repository.ts`
- `backend/src/mcp/server.ts`
- `backend/src/app.test.ts`
- `backend/src/testing/replayHarness.ts`
- `cli/src/`
- `frontend/src/`
- `DATA-MODEL.md`
- `ARCHITECTURE.md`
- `CLI.md`
- `MCP.md`

## Dependencies

- [backlog/completed/pre-extension-runtime-generalization.md](backlog/completed/pre-extension-runtime-generalization.md)
- [backlog/completed/session-backed-deterministic-harness-data-model.md](backlog/completed/session-backed-deterministic-harness-data-model.md)
- [backlog/completed/session-metadata-foundation.md](backlog/completed/session-metadata-foundation.md)
- [backlog/completed/session-analysis-launch-and-report.md](backlog/completed/session-analysis-launch-and-report.md)

## Expected result

After this increment:

- mcpscope still behaves like today from the user's point of view across current surfaces
- the backend runtime is organized around `SessionContainer`, `Session`, `Step`, and `Turn`
- the persistence layer is ready for future workflow-specific session and step extension without table-per-subtype growth
- benchmark ownership no longer requires another near-term model rewrite
- the codebase is in a safer position for later deterministic-step and richer workflow work