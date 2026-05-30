# Session execution model convergence

This task defines the final cleanup increment that should land on top of the current `session-execution-model-refactor` branch / PR before merge.

It is intentionally narrow. The execution-model refactor is already landed functionally; this increment exists to remove the remaining transitional runtime/persistence seams that should have been part of Step 9, while keeping product behavior stable.

## Why this task exists

The current branch has already established the new execution vocabulary and the v2-backed runtime path:

- `SessionContainer`, `Session`, `Step`, and `Turn` are the canonical execution-model terms
- runtime behavior is already running on `v2_sessions`, `v2_steps`, `v2_turns`, `v2_rounds`, `v2_parts`, and `v2_raw_exchanges`
- backend/API/CLI/MCP/UI parity for current behavior has been smoke-tested

But the implementation still carries transitional seams that should be cleaned up before merge:

- startup still depends on `initializeBackendSchema(...)` for config/singleton tables, and that initializer also creates obsolete v1 runtime tables as empty scaffolding
- the main public repository entry point still exports its runtime CRUD surface from `repositoryCompat.ts`
- comments and docs still describe parts of the implementation as being in a porting or compatibility phase, rather than clearly documenting what is still transitional versus what is now canonical

This task finishes that convergence work without broadening into new product capabilities.

## Goal

Finish the refactor cleanly by:

1. separating active schema ownership from obsolete v1 runtime-table scaffolding
2. removing `compat` framing from the main runtime repository path
3. making the remaining intentionally deferred limitations explicit in docs, without scattering them across transitional comments

## Scope

### 1. Persistence startup and schema ownership cleanup

- keep current runtime/session execution state entirely on the canonical v2 tables
- stop creating obsolete legacy runtime tables (`sessions`, `turns`, `rounds`, `parts`, `raw_exchanges`) at normal startup if they are no longer used for any current behavior
- split config/singleton table initialization from legacy runtime-table initialization if needed
- keep config/default/profile tables working exactly as they do now
- update schema comments so they describe the landed state truthfully, not an earlier porting phase

### 2. Repository convergence

- remove `repositoryCompat.ts` as the apparent canonical runtime path if it is no longer serving a real compatibility purpose
- keep the current public repository function surface stable for existing callers unless there is a strong reason to change it
- prefer either:
  - folding the v2-backed implementation into `repository.ts`, or
  - renaming/restructuring files so the primary runtime path is no longer branded as compatibility code
- do not introduce a new long-lived abstraction layer just to preserve old naming

### 3. Documentation cleanup for the landed state

- update canonical docs where needed:
  - `ARCHITECTURE.md`
  - `DATA-MODEL.md`
  - `README.md`
  - `CLI.md`
  - `MCP.md`
- consolidate the currently intentional limitations into explicit wording such as:
  - remaining v1 parent/session rules
  - deterministic non-LLM step types are still future work
  - benchmark support remains minimal
- remove or rewrite wording that implies the runtime is still midway through the original porting phase when that is no longer the right description

## Non-goals

- no new workflow or deterministic `Step` product feature in this increment
- no benchmark product expansion beyond what already exists
- no broad canonical contract redesign beyond what is necessary to make the landed implementation truthful and coherent
- no UI redesign
- no adapter-specific product changes unless required by the cleanup
- no opportunistic renaming churn if it materially increases migration risk without reducing real complexity

## Constraints

- preserve current user-visible behavior across backend, HTTP/API, CLI, MCP, and UI
- keep machine-readable outputs stable unless a change is required to align docs/contracts truthfully
- keep the frontend thin; do not move runtime ownership into Svelte components
- treat this as the cleanup tail of the current refactor, not as a new architecture initiative
- prefer root-cause cleanup over comments that rationalize leftover transitional structure

## Acceptance criteria

1. The active runtime/persistence path is clearly singular and no obsolete v1 runtime-table path is silently created or required for current behavior.
2. The primary repository path is no longer presented as compatibility code when serving the canonical runtime.
3. Canonical docs accurately distinguish between:
   - what is now canonical and implemented
   - what is intentionally still constrained in the current release
   - what remains future work
4. Current behavior continues to work across backend, HTTP/API, CLI, MCP, and UI surfaces.
5. The cleanup lands as a narrow convergence increment on top of the current branch, not as a broadened redesign.

## Validation

Required validation path:

- `npm run check:backend`
- `npm test -- backend/src/sessionMetadata.test.ts`
- `npm test -- backend/src/app.test.ts -t "analysis launch|send|sessions|trace|status"`

Run these when applicable:

- `npm test` if persistence cleanup changes enough backend behavior that the focused app slice is not sufficient
- `npm run check:cli` if CLI code changes or CLI-facing contract wording changes materially
- `npm run check` if frontend code changes

Prefer focused deterministic validation before widening to broader suites.

## Likely touch points

- `backend/src/persistence/db.ts`
- `backend/src/persistence/schema.ts`
- `backend/src/persistence/schemaV2.ts`
- `backend/src/persistence/repository.ts`
- `backend/src/persistence/repositoryCompat.ts`
- `backend/src/persistence/repositoryV2.ts`
- `ARCHITECTURE.md`
- `DATA-MODEL.md`
- `README.md`
- `CLI.md`
- `MCP.md`

## Dependencies and context

- [backlog/completed/pre-extension-runtime-generalization.md](backlog/completed/pre-extension-runtime-generalization.md)
- [backlog/completed/session-backed-deterministic-harness-data-model.md](backlog/completed/session-backed-deterministic-harness-data-model.md)
- [backlog/completed/session-execution-model-refactor.md](backlog/completed/session-execution-model-refactor.md)
- [backlog/completed/session-execution-model-refactor-pr16-followup.prompt.md](backlog/completed/session-execution-model-refactor-pr16-followup.prompt.md)

## Expected result

After this increment:

- the current PR no longer carries avoidable runtime/persistence compatibility framing
- the backend startup and schema story are clearer and more honest
- the docs describe the landed architecture as a stable baseline with explicit current limits
- the project is in a cleaner state to begin follow-up work on direct use of `SessionContainer` / `Session` / `Step` rather than continuing to pay down transitional scaffolding