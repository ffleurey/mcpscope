# Analysis sessions — WorkflowStep class hierarchy

This task completes the step containment vision from `refactor-step-containement.md`
(housekeeping + domain wiring) and then builds the Command-pattern step class
hierarchy on that clean foundation.  The result is a single, linear plan with no
conceptual gaps between the containment model, the execution model, and the
business-logic encapsulation.

### How to read the verification blocks

Each increment lists **what to verify** — the concrete conditions that must hold
after the increment completes.  The exact commands to check these conditions are
not specified; use whatever grep, file-system, or typecheck approach is appropriate
for the current state of the code.  The conditions are the contract, not the commands.

### How to handle ripple

When a change surfaces compilation failures in unexpected files, do not add
compatibility shims or workarounds.  Instead:

1. Diagnose why the file depends on what was changed.
2. If the dependency is legitimate, update the file toward the target architecture
   (e.g., adopt the new import path, use the new type, wire through the new class).
3. If the dependency is accidental (dead imports, unused type references), remove it.
4. If the ripple reveals a genuine missing piece in the plan, flag it and extend
   the current increment — do not silently drift.

The test suite is the guardrail.  After every increment, `npm run check:backend`
must pass.  At phase boundaries, `npm test` must pass.  No exceptions.

---

## Phase 0: Complete the containment groundwork

The previous task delivered schema columns, ID grammar, and tree-shape work
but left several items unfinished.  These increments finish them so the domain
model is coherent before we build on it.

### Increment 0.1 — Dead code removal and persistence cleanup

**Files to modify:**

- `backend/src/persistence/repositoryV2.ts` — remove `insertTurnV2Record`, which writes old column names
  (`step_id`, `sequence_number`) that no longer exist in the schema.  Verify no callers remain.
- `backend/src/persistence/schema.ts` — remove legacy table definitions (`sessions`, `turns`,
  `rounds`, `parts`, `raw_exchanges`) from `initializeBackendSchema()` and the companion
  `legacyTables` object.  The legacy initializer in tests that validates old-schema shapes
  can stay if tests reference it, but the normal runtime path must not define them.
- `backend/src/domain/persistenceContract.ts` — rename `TurnPersistenceRecord.sequenceNumber`
  → `turnNumber` and `.stepId` → `.id` to match the current schema columns.

**Acceptance:**

- `npm run check:backend` passes.
- Grep for `insertTurnV2Record` returns zero callers in production code.
- Grep for `sequenceNumber` in `persistenceContract.ts` returns zero.
- `initializeBackendSchema()` no longer creates legacy tables.

**Verification:**

- `insertTurnV2Record` is not referenced anywhere in `backend/src/`.
- `TurnPersistenceRecord` in `persistenceContract.ts` uses `turnNumber` and `id` (not `sequenceNumber` / `stepId`).
- `initializeBackendSchema()` does not create legacy runtime tables (`sessions`, `turns`, `rounds`, `parts`, `raw_exchanges`).  A dedicated legacy init used only by old-schema validation tests is acceptable.
- `npm run check:backend` passes.

---

### Increment 0.2 — Update `executionModelMapping.ts` to active status

Current state: the file comment at line 15 says "At this stage (Step 1)" and the
mapping is "declared, not yet behaviorally wired."  In practice the schema columns
already match the domain concepts — owned turns already exist, containment IDs
are in use.  The mapping is de-facto wired; the comment is stale.

- Update the file-level comment to remove the "Step 1" marker and state that
  the mapping is active.
- Verify that the nominal type guards (`isSessionContainer`, `isBenchmarkContainer`)
  compile against the current runtime types.
- Add explicit `STEP_TYPE` entries for the five concrete analysis step types
  as constant members:

  ```
  ANALYSIS_BOOTSTRAP       stepTypeKey('analysis_bootstrap')
  ANALYSIS_TOOL_CALL_ASSESSMENT  stepTypeKey('analysis_tool_call_assessment')
  ANALYSIS_TOOL_GROUP_ASSESSMENT stepTypeKey('analysis_tool_group_assessment')
  ANALYSIS_TURN_SUMMARY    stepTypeKey('analysis_turn_summary')
  ANALYSIS_FINAL_AGGREGATION     stepTypeKey('analysis_final_aggregation')
  ```

  These are the persisted `stepTypeKey` values already used by `createStep()` today.

**Acceptance:**

- `executionModelMapping.ts` no longer describes itself as "Step 1" or "not behaviorally wired."
- `STEP_TYPE` has entries for all five analysis step types.
- `check:backend` passes.

**Verification:**

- `executionModelMapping.ts` contains no "Step 1", "not yet", or "declared but not behaviorally wired" language.
- `STEP_TYPE` in `executionModel.ts` has entries for all five analysis step types (`ANALYSIS_BOOTSTRAP`, `ANALYSIS_TOOL_CALL_ASSESSMENT`, `ANALYSIS_TOOL_GROUP_ASSESSMENT`, `ANALYSIS_TURN_SUMMARY`, `ANALYSIS_FINAL_AGGREGATION`).
- `npm run check:backend` passes.

---

### Increment 0.3 — Compaction step unification (shared number space)

Compaction steps currently live in a **separate number space** from workflow steps
because the old `getNextStepDisplayNumber` excluded compaction.  That function was
already removed; only `getNextChildIndex` remains.  However, the compaction code
still uses `getNextChildIndex` directly while workflow steps use it indirectly
through `formatStepId` — verify both paths produce consecutive IDs in the same
number space.

- Remove any remaining special-casing of compaction in step counting.
- Ensure `getNextChildIndex(sessionId, db)` is the single source of truth for
  all step positions.
- Update test assertions that hardcode specific step IDs to match the new
  single-number-space convention (e.g. `3W`, `4C`, `5W` rather than gaps).

**Acceptance:**

- `getNextChildIndex` is the only step-position counter in the codebase.
- `npm test` passes with updated numbering expectations.

**Verification:**

- `getNextChildIndex` is the only step-position counting function in the persistence layer (no `getNextStepDisplayNumber` or `getNextStepOrdinal` remain).
- No compaction-specific exclusion logic exists in step counting (no checks against `step_type_key` filtering out compaction).
- `npm test` passes.

---

## Phase 1: Abstract `WorkflowStep` class

This phase creates the reusable abstract base class that implements the domain
`WorkflowStep` interface.  It handles step-record lifecycle so concrete steps
only write business logic.

### Increment 1.1 — Create `workflow/workflowStep.ts`

**Design decisions (settled):**

1. **Constructor injection for infrastructure.**  `db`, `lmGateway`, and `mcpGateway`
   are passed at construction time, matching the `ChatTurnStep` pattern
   (`chatSession.ts:49`).  They do not vary between executions of the same step
   within a workflow and are the same for all steps in a given analysis session.

2. **`StepContext` is a per-execution parameter bag.**  `execute(ctx)` receives
   a `StepContext` carrying execution-scoped data: `sessionId`, `stepTypeKey`,
   `emitSink`, and optionally workflow-specific state.  This is deliberately
   **not** the domain `StepExecutionContext` — that interface serves the scheduler's
   uniform dispatch and carries minimal data.  The abstract `WorkflowStep` has
   its own richer context because business logic needs infrastructure at
   construction time, not at every execution.

3. **`run(ctx)` is the only abstract method.**  Concrete steps override `run()`
   to write business logic.  The base class `execute()` handles:
   - Creating the `StepPersistenceRecord` via `insertStepRecord()`
   - Computing `childIndex` via `getNextChildIndex()`
   - Calling `run(ctx)`
   - Marking the record complete or failed
   - Emitting `analysis-step-started` / `analysis-step-completed` events

4. **No analysis imports.**  The abstract class lives in `backend/src/workflow/`
   as a sibling to `analysis/` and `domain/`.  It imports only from `domain/`
   and `persistence/`, never from `analysis/`.

**File layout:**

```
backend/src/workflow/
  workflowStep.ts          abstract class
  stepContext.ts           StepContext interface
```

**`StepContext` (draft):**

```ts
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import type { StepTypeKey } from '../domain/executionModel.js'

export interface StepContext {
  sessionId: string
  stepTypeKey: StepTypeKey
  emitSink?: AnalysisStreamEventSink
}
```

**`WorkflowStep` abstract class (draft shape):**

```ts
export abstract class WorkflowStep implements WorkflowStepDomain {
  readonly stepId: string
  readonly stepTypeKey: StepTypeKey
  readonly turns: ReadonlyArray<Turn> = []
  status: StepStatus = 'pending'
  params: GenericParams = {}
  state: GenericState = {}

  constructor(
    protected readonly db: BackendDatabase,
    protected readonly lm: LmStudioGateway,
    protected readonly mcp: McpGateway,
  ) {}

  abstract get stepLabel(): string

  async execute(ctx: StepContext): Promise<StepResult> {
    // create step record via insertStepRecord
    // emit analysis-step-started
    // call this.run(ctx)
    // complete or fail the record
    // emit analysis-step-completed
    // return StepResult
  }

  protected abstract run(ctx: StepContext): Promise<StepResult>

  // convenience: logger, artifact access, runModelTurn, etc.
}
```

**Acceptance:**

- `workflow/workflowStep.ts` compiles without importing from `analysis/`.
- The class implements the `WorkflowStep` domain interface from `executionModel.ts`.
- `StepContext` is a standalone type in `workflow/stepContext.ts`.
- `check:backend` passes.

**Verification:**

- `workflow/workflowStep.ts` does not import anything from `analysis/`.
- The class `implements WorkflowStep` from the domain model.
- `StepContext` is in `workflow/stepContext.ts` and does not import from `analysis/`.
- The abstract `execute()` method calls `insertStepRecord`, calls `run(ctx)`, and handles completion/failure/event emission in the base class (not in subclasses).
- `npm run check:backend` passes.

---

## Phase 2: Concrete analysis step classes

Each step class owns its Zod schema (or a reference to a shared one) and its
prompt builder, so a reader can open one file and see what the step validates,
what it produces, and what it asks the LLM.

### Increment 2.1 — Shared analysis steps

Create four step classes used by both `FullSession` and `FastSession`:

| Class | File | Replaces |
|---|---|---|
| `BootstrapStep` | `analysis/shared/bootstrapStep.ts` | `runBootstrapStep()` + `runFastToolPlanningStep()` |
| `ToolCallAssessmentStep` | `analysis/shared/toolCallAssessmentStep.ts` | `runToolCallAssessmentTurn()` |
| `TurnSummaryStep` | `analysis/shared/turnSummaryStep.ts` | `runTurnSummaryTurn()` |
| `FinalAggregationStep` | `analysis/shared/finalAggregationStep.ts` | `runFinalAggregationTurn()` |

**Design notes:**

- `BootstrapStep` handles both full/fast-session bootstrap and fast-tool planning.
  It receives a `planningMode: 'session' | 'tool'` constructor parameter.
- `ToolCallAssessmentStep` receives `artifactSchemaKey` and `promptVariant` in the
  constructor — FullSession passes one key/variant, FastSession passes another.
  No subclass needed just to change a string.
- `TurnSummaryStep` and `FinalAggregationStep` follow the same pattern.

- Each step class file contains:
  - The Zod schema it validates against (imported from `schemas.ts` or defined locally)
  - The prompt builder it sends to the LLM (imported from `evaluationPrompts.ts` or defined locally)
  - The `run(ctx)` method with business logic
  - Context mutation helpers (currently `runContextMutationStep` / `retire*PromptContext`)
    folded into the step class as private methods

- Deterministic McpInspect orchestration (`runDeterministicMcpToolCallsInSingleTurn`)
  is called from within `run(ctx)` using `this.mcp` and `this.db` — the step
  handles it internally.

**Acceptance:**

- All four step classes compile and extend `WorkflowStep`.
- Each file imports or defines its Zod schema and prompt builder.
- `check:backend` passes.

**Verification:**

- All four files exist: `bootstrapStep.ts`, `toolCallAssessmentStep.ts`, `turnSummaryStep.ts`, `finalAggregationStep.ts` in `analysis/shared/`.
- All four extend `WorkflowStep`.
- Each file imports or locally defines a Zod schema and a prompt builder.
- `ToolCallAssessmentStep` constructor accepts `artifactSchemaKey` and `promptVariant` parameters.
- `npm run check:backend` passes.

---

### Increment 2.2 — Workflow-specific steps

**`FastToolGroupedAssessmentStep`** (`analysis/fastTool/fastToolGroupedAssessmentStep.ts`):

- Replaces `runFastToolGroupedAssessmentTurn()`.
- Only used by `FastToolAnalysis` — lives in its own directory, not in `shared/`.
- Hardcodes its `artifactSchemaKey` and prompt since it's never reused.

**Acceptance:**

- `fastToolGroupedAssessmentStep.ts` compiles.
- No other analysis workflow imports it.

**Verification:**

- `fastToolGroupedAssessmentStep.ts` exists and extends `WorkflowStep`.
- It is not imported by any file in `analysis/shared/`, `analysis/fullSession/`, or `analysis/fastSession/`.
- `npm run check:backend` passes.

---

## Phase 3: Wire hooks to step classes

Replace standalone function calls in hooks with step class instantiation.

### Increment 3.1 — Add `buildStepContext()` to `AnalysisSessionBase`

The base class gains a protected method that builds a `StepContext` from the
analysis session's current state.  This is the bridge between the hook traversal
engine and the Command-pattern step classes.

```ts
protected buildStepContext(stepTypeKey: StepTypeKey): StepContext {
  return {
    sessionId: this.sessionId,
    stepTypeKey,
    emitSink: this.emitSink,
  }
}
```

Remove from the base class:
- `createStep()` — lifecycle moves to `WorkflowStep.execute()`
- `completeStep()` — lifecycle moves to `WorkflowStep.execute()`
- `failStep()` — lifecycle moves to `WorkflowStep.execute()`
- `runModelTurn()` — stays but is no longer the primary API; steps call it internally

Replace the `AnalysisStreamEventSink` typing on `emitFn` with the shared import
from `workflow/stepContext.ts` so the analysis base no longer owns the stream
event type definition.

**Acceptance:**

- `buildStepContext()` exists and is callable from subclasses.
- `createStep`, `completeStep`, `failStep` are removed from `AnalysisSessionBase`.
- `check:backend` passes.

**Verification:**

- `buildStepContext()` exists on `AnalysisSessionBase` and is callable from subclasses.
- `createStep`, `completeStep`, `failStep` are removed from `AnalysisSessionBase`.
- If subclasses still reference the removed methods at this point, that's expected — Inc 3.2 fixes them.
- `npm run check:backend` passes (on the base class itself; subclass failures are for the next increment).

---

### Increment 3.2 — Update hook implementations

**`FullSessionAnalysis`** (`analysis/fullSession/fullSessionAnalysis.ts`):

```ts
protected async beforeSession(): Promise<void> {
  if (this.state.bootstrapComplete) return
  this.emit({ type: 'analysis-phase-changed', phase: 'bootstrap' })
  await new BootstrapStep(this.db, this.mcp, this.lm).execute(
    this.buildStepContext(STEP_TYPE.ANALYSIS_BOOTSTRAP)
  )
  // state updated inside the step's run()
}

protected async onToolCall(part, round, turn): Promise<void> {
  // ... same gate logic ...
  await new ToolCallAssessmentStep(this.db, this.lm, this.mcp, {
    artifactSchemaKey: SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
    promptVariant: 'full',
  }).execute(this.buildStepContext(STEP_TYPE.ANALYSIS_TOOL_CALL_ASSESSMENT))
}
```

Same pattern for `afterTurn` → `TurnSummaryStep` and `afterSession` → `FinalAggregationStep`.

**`FastSessionAnalysis`** (`analysis/fastSession/fastSessionAnalysis.ts`):

Same pattern with `artifactSchemaKey: SCHEMA_KEY.FAST_TOOL_CALL_ASSESSMENT` and
`promptVariant: 'fast'`.

**`FastToolAnalysis`** (`analysis/fastTool/fastToolAnalysis.ts`):

`beforeSession` delegates to `BootstrapStep` with `planningMode: 'tool'`.
`onToolCall` delegates to `FastToolGroupedAssessmentStep`.
`afterSession` delegates to `FinalAggregationStep` with fast-tool schema keys.

**Acceptance:**

- All three analysis subclasses compile with the new hook bodies.
- No standalone `run*Turn()` calls remain in hooks.
- `check:backend` passes.

**Verification:**

- No standalone function calls (`runToolCallAssessmentTurn`, `runTurnSummaryTurn`, `runFinalAggregationTurn`, or their fast/fastTool equivalents) remain in any of the three analysis subclass files.
- Each subclass instantiates step classes with `new ...Step(` and calls `.execute()`.
- `runBootstrapStep` is replaced with `new BootstrapStep(...)`; the old `bootstrapStep.ts` import is gone.
- `npm run check:backend` passes.

---

### Increment 3.3 — Delete old standalone files

Remove:

```
analysis/fullSession/toolCallAssessmentTurn.ts
analysis/fullSession/turnSummaryTurn.ts
analysis/fullSession/finalAggregationTurn.ts
analysis/fullSession/contextMutationStep.ts
analysis/fastSession/fastToolCallAssessmentTurn.ts
analysis/fastSession/fastTurnSummaryTurn.ts
analysis/fastSession/fastFinalAggregationTurn.ts
analysis/fastTool/fastToolPlanningStep.ts
analysis/fastTool/fastToolGroupedAssessmentTurn.ts
analysis/fastTool/fastToolFinalAggregationTurn.ts
analysis/fastToolContextMutationStep.ts
analysis/bootstrapStep.ts
analysis/coverageValidationStep.ts
```

Some logic from these files moves into the new step classes; context mutation
logic moves into private methods on the step class; `coverageValidationStep`
logic folds into the appropriate step class.

**Note on evaluation prompts (`evaluationPrompts.ts` files):**

The prompt builder functions in `analysis/fullSession/evaluationPrompts.ts`,
`analysis/fastSession/evaluationPrompts.ts`, and `analysis/fastTool/evaluationPrompts.ts`
are imported by the new step classes and remain in place.  They are pure functions,
not workflow logic, and their current location next to the workflow they serve
remains appropriate.

**Acceptance:**

- All 12 files listed above are deleted.
- Grep for deleted function names (`runToolCallAssessmentTurn`, etc.) in
  `analysis/` returns zero results.
- `npm test` passes.
- `check:backend` passes.

**Verification:**

- All 12 files listed above are deleted from disk.
- No import of any deleted file remains anywhere in `backend/src/`.
- The three evaluation prompts files (`evaluationPrompts.ts` under fullSession, fastSession, fastTool) still exist.
- `npm test` passes.
- `npm run check:backend` passes.

---

## Phase 4: Domain model, tests, and validation

### Increment 4.1 — Remove dead domain interfaces

The domain model in `executionModel.ts` has two dead interfaces:

- `Turn extends Step` — never implemented.  The runtime uses `TurnRecord` from
  `model.ts` and `TurnPersistenceRecord` from `persistenceContract.ts`, not this
  domain interface.  `ChatTurnStep` implements `Step`, not `Turn`.
- `WorkflowStep extends Step` — currently unused.  After this task, the new
  abstract `WorkflowStep` class in `workflow/` implements it.  The interface
  itself stays, but remove the `turns: ReadonlyArray<Turn>` field if it
  would force a dependency on the dead `Turn` interface.

Keep `Step` and `Session` — `ChatTurnStep` and `ChatSession` implement them
and they serve as the scheduler's dispatch contract.

**Acceptance:**

- `Turn` interface is removed or annotated as deferred.
- `WorkflowStep` interface compiles cleanly with the new concrete implementations.
- `check:backend` passes.

**Verification:**

- The `Turn` interface is removed from `executionModel.ts` (or annotated as deferred with a clear comment).  Any compilation failures that surface in other files are legitimate ripple — fix each by adopting the new architecture, not by adding compatibility shims.
- `WorkflowStep` interface remains in `executionModel.ts` and compiles cleanly against the concrete class in `workflow/workflowStep.ts`.
- `npm run check:backend` passes.

---

### Increment 4.2 — Update tests and final validation

- Update `analysisWorkflow.test.ts` to instantiate step classes instead of calling
  standalone functions directly.  Test hooks that validate step lifecycle
  (creation, completion, failure) now exercise the abstract `WorkflowStep.execute()`
  path.
- Update `app.test.ts` for any schema/type changes.
- Update `hierarchicalIds.test.ts` if compaction unification changes numbering.
- Run full suite:

  ```
  npm run check:backend   # must be green
  npm test                # must be green (168+ tests)
  ```

**Acceptance:**

- All existing tests pass.
- At least one test validates that `WorkflowStep.execute()` correctly creates,
  completes, and fails step records.
- At least one test validates that a concrete step's `run()` produces the
  expected artifact.

**Verification:**

```bash
npm run check:backend
npm test
```

---

## Final verification checklist

Run this checklist once after Inc 4.2 passes.  Every item must hold.  Do not use
exact grep patterns — verify the conditions below with whatever inspection method
is appropriate for the current state of the code.

### Phase 0 — containment cleanup

- [ ] `insertTurnV2Record` has no references in `backend/src/`
- [ ] `TurnPersistenceRecord` uses `turnNumber` and `id`, not `sequenceNumber` and `stepId`
- [ ] `executionModelMapping.ts` contains no "Step 1" or "not yet behaviorally wired" language
- [ ] `STEP_TYPE` has all five analysis step type constants
- [ ] `getNextChildIndex` is the only step-position counter (no `getNextStepDisplayNumber` or `getNextStepOrdinal`)
- [ ] No compaction exclusion logic exists in step counting

### Phase 1 — abstract framework

- [ ] `workflow/workflowStep.ts` and `workflow/stepContext.ts` exist
- [ ] Neither file imports from `analysis/`
- [ ] The abstract class `implements WorkflowStep` from the domain model
- [ ] The base `execute()` handles step record lifecycle (create, run, complete/fail, emit)

### Phase 2 — concrete step classes

- [ ] Four shared steps exist in `analysis/shared/` (bootstrap, toolCallAssessment, turnSummary, finalAggregation)
- [ ] All four extend `WorkflowStep`
- [ ] Each imports or defines a Zod schema and a prompt builder
- [ ] `ToolCallAssessmentStep` constructor accepts `artifactSchemaKey` and `promptVariant`
- [ ] `fastToolGroupedAssessmentStep.ts` exists in `analysis/fastTool/` and extends `WorkflowStep`
- [ ] It is not imported by any other workflow directory

### Phase 3 — hook wiring

- [ ] `createStep`, `completeStep`, `failStep` are absent from `AnalysisSessionBase`
- [ ] `buildStepContext()` exists on `AnalysisSessionBase`
- [ ] No standalone `run*Turn()` or `run*Step()` calls remain in the three analysis subclasses
- [ ] Each subclass instantiates step classes with `new ...Step(...)` and calls `.execute()`
- [ ] All 12 old standalone files are deleted from disk
- [ ] No stale import of a deleted file remains anywhere in `backend/src/`
- [ ] The three evaluation prompts files still exist (`evaluationPrompts.ts` under each workflow dir)

### Phase 4 — domain model and tests

- [ ] The dead `Turn` interface is removed from `executionModel.ts`
- [ ] `npm run check:backend` passes
- [ ] `npm test` passes (168+ tests)
- [ ] At least one test covers `WorkflowStep.execute()` lifecycle (create, complete, fail)
- [ ] At least one test covers a concrete step's `run()` producing the expected artifact

---

## Summary of what gets deleted

| Category | Files |
|---|---|
| Dead repository function | `repositoryV2.ts` — `insertTurnV2Record` |
| Legacy table definitions | `schema.ts` — legacy `sessions`/`turns`/`rounds`/`parts`/`raw_exchanges` DDL |
| Standalone analysis functions | 12 `*Turn.ts`, `*Step.ts` files (see §3.3) |
| Base class methods | `createStep()`, `completeStep()`, `failStep()` from `AnalysisSessionBase` |
| Dead domain interfaces | `Turn` from `executionModel.ts` |

## Summary of what gets created

| File | Purpose |
|---|---|
| `workflow/workflowStep.ts` | Abstract `WorkflowStep` class with lifecycle management |
| `workflow/stepContext.ts` | `StepContext` interface |
| `analysis/shared/bootstrapStep.ts` | `BootstrapStep` (session and tool modes) |
| `analysis/shared/toolCallAssessmentStep.ts` | `ToolCallAssessmentStep` (shared by Full + Fast) |
| `analysis/shared/turnSummaryStep.ts` | `TurnSummaryStep` (shared by Full + Fast) |
| `analysis/shared/finalAggregationStep.ts` | `FinalAggregationStep` (shared by all three) |
| `analysis/fastTool/fastToolGroupedAssessmentStep.ts` | `FastToolGroupedAssessmentStep` (FastTool only) |

## Implementation order (linear)

```
Inc 0.1 — Dead code removal and persistence cleanup ✓
Inc 0.2 — Update executionModelMapping.ts to active status
Inc 0.3 — Compaction step unification
Inc 1.1 — Create workflow/workflowStep.ts + workflow/stepContext.ts
Inc 2.1 — Create analysis/shared/*Step.ts (4 concrete steps)
Inc 2.2 — Create fastToolGroupedAssessmentStep.ts
Inc 3.1 — Add buildStepContext() to AnalysisSessionBase, remove old step lifecycle
Inc 3.2 — Update hook implementations in all three subclasses
Inc 3.3 — Delete 12 old standalone files
Inc 4.1 — Clean up dead domain interfaces
Inc 4.2 — Update tests, final validation
```

### Completed increments

#### Inc 0.1 — Dead code removal and persistence cleanup ✓

Changes:
- Removed 5 dead V2 turn functions from `repositoryV2.ts` (`insertTurnV2Record`, `getTurnV2Record`, `updateTurnV2Record`, `listTurnV2RecordsBySession`, `getNextTurnV2SequenceNumber`). All zero callers, used old column names.
- Removed `TurnPersistenceRecord` import from `repositoryV2.ts`.
- Removed legacy runtime table DDL from `initializeBackendSchema()` in `schema.ts` (`sessions`, `turns`, `rounds`, `parts`, `raw_exchanges` and their indexes). The normal runtime path (`initializeBackendSupportSchema` + `initializeNewSchema`) was already clean.
- Removed ALTER TABLE migrations targeting legacy `turns` and `parts` tables from `initializeBackendSchema()`.
- Removed `turns` and `parts` from `validateBackendSchema()` validation (only `sessions` validation remains for the legacy backward-compat test).
- Cleaned up 14 unused enum imports from `schema.ts`.
- Renamed `TurnPersistenceRecord.stepId` → `id` and `.sequenceNumber` → `turnNumber` in `persistenceContract.ts`.
- Renamed `TurnRepository.getByStepId()` → `getById()` in `persistenceContract.ts`.

No ripple: all changes were local to dead code and unused imports. 168 tests pass.
```

Each increment must pass `npm run check:backend` before the next begins.
Phase boundaries are the right places to run `npm test` (after Inc 0.3, after Inc 2.2,
after Inc 3.3, and after Inc 4.2).

## Design decisions captured

1. **Infrastructure at construction, execution state at execute time.**
   `db`, `lm`, `mcp` are constructor parameters (match `ChatTurnStep`).
   `sessionId`, `stepTypeKey`, `emitSink` are in `StepContext` passed to `execute()`.

2. **`WorkflowStep.execute(ctx)` is NOT the domain `Step.execute(StepExecutionContext)`.**
   The abstract class has its own `execute(ctx: StepContext)` with a richer
   context.  It implements the domain `WorkflowStep` interface's structural
   contract (`stepId`, `stepTypeKey`, `turns`, `status`, `params`, `state`)
   but its execution contract is independent.  The domain `Step.execute()`
   remains the scheduler's uniform dispatch contract used by `ChatTurnStep` only.

3. **Constructor parameter for schema key and prompt variant, not subclassing.**
   Shared steps accept configuration in their constructor.  No subclass needed
   just to change a string.

4. **`run(ctx)` is the only abstract method.**  The base class handles step record
   creation, persistence, event emission, and error handling.

5. **The abstract class lives in `workflow/` at the `src/` level.**
   No analysis imports in the framework.  Future agent types can extend it.

6. **No dependency-injection container, no factory registries, no decorators.**
   Steps are created with `new` in the hook methods.
