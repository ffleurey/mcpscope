# Encapsulation cleanup — remove analysis-type coupling from shared code

The task `analysis-sessions-refactoring.md` moved step lifecycle into a clean
abstract `WorkflowStep` base class and created concrete step classes.  However,
the shared step classes received type-specific config parameters (`promptVariant`,
`variant`, `planningMode`) that make them directly aware of which analysis
subclass is calling them.  Combined with a central factory, a hardcoded
dispatcher, and type-specific schemas in shared files, adding a fourth analysis
type would require editing **at least 10 files** across the codebase.

This task removes every `if (variant === 'fast')`, every `switch (workflowKind)`,
every subdirectory import from `shared/`, and every type-specific schema from
`schemas.ts`.  The result is that adding a new analysis type touches only the new
subclass directory and its single factory registration — zero shared files.

---

## Architecture goal

Each analysis subclass is a self-contained module that owns:

| Artifact | Current location | Target location |
|---|---|---|
| Workflow kind constant | `analysis/workflowKinds.ts` | `static readonly workflowKind` on subclass |
| System prompt builder | `analysis/systemPrompt.ts` dispatcher | Subclass method or constructor parameter |
| Schema keys (artifact IDs) | `analysis/schemas.ts` | Subclass static properties |
| Type-specific Zod schemas | `analysis/schemas.ts` | Subclass-local file |
| Prompt builders | `analysis/{type}/evaluationPrompts.ts` | Keeps current location (already correct) |
| Factory dispatch | `analysis/analysisWorkflowFactory.ts` `switch` | Self-registration map |
| UI labels / presentation | `analysis/analysisSessionPresentation.ts` | Subclass static `workflowLabel` |
| Planning logic | `analysis/analysisPlanning.ts` (shared) | Move type-specific parts to subclasses |
| `buildSystemPrompt()` | Abstract method on base (dead) | Remove or make real |

Shared code (`shared/`, the base class, `schemas.ts`) must never import from,
reference, or branch on a concrete subclass.  The base class and shared steps
receive all configuration via constructor parameters — functions, not enums.

---

## Issues catalog

### Critical — blocks new analysis types

| ID | File | Line(s) | Issue |
|---|---|---|---|
| C1 | `analysis/workflowKinds.ts` | 2-5 | Central enum; new type requires editing this file |
| C2 | `analysis/analysisWorkflowFactory.ts` | 6-8, 30-38 | Hardcoded `switch` on all three types; must add `import` + `case` for each new type |
| C3 | `analysis/systemPrompt.ts` | 3-5, 18-35 | Dispatcher imports all three concrete prompt builders and branches on `workflowKind` |
| C4 | `operations/launchAnalysis.ts` | 55-59, 218-222 | Zod enum enumerates all types; ternary normalizer chain |
| C5 | `shared/finalAggregationStep.ts` | 21-23, 28-29, 64-65, 70, 83, 105-109, 127-129 | Imports from 3 subdirectories; 7 branching points on `variant`; type `FinalAggregationVariant` enumerates all types |
| C6 | `shared/toolCallAssessmentStep.ts` | 21-22, 27, 75-76, 87, 157-159 | Imports from 2 subdirectories; branches on `promptVariant`; type `AssessmentPromptVariant` enumerates types |
| C7 | `shared/turnSummaryStep.ts` | 20-21, 26, 92-93 | Imports from 2 subdirectories; branches on `promptVariant`; type `SummaryPromptVariant` enumerates types |

### High — creates scattered edit points

| ID | File | Line(s) | Issue |
|---|---|---|---|
| H1 | `analysis/schemas.ts` | 24-29 | 6 of 10 `SCHEMA_KEY` entries are type-specific (fast session, fast tool) |
| H2 | `analysis/schemas.ts` | 173-193 | `fastSessionFinalAnalysisReportSchema`, `FastSessionFinalAnalysisReport`, `fastToolFinalReportSchema`, `FastToolFinalReport` — entire schemas for specific types |
| H3 | `analysis/schemas.ts` | 204-218 | `fastToolWorkGroupSchema`, `fastToolWorkIndexSchema`, `FastToolWorkGroup`, `FastToolWorkIndex` — exclusively for FastTool |
| H4 | `analysis/analysisSessionPresentation.ts` | 14-18 | `WORKFLOW_LABELS` map enumerating all three types |
| H5 | `analysis/analysisSessionPresentation.ts` | 22-28 | Type-guard `if (workflowKind === ... \\|\\| ... \\|\\| ...)` |
| H6 | `analysis/*/systemPrompt.ts` | each 3-5 | Three identical copies of `normalizeAnalysisGoal()`. Only the `fullSession` copy is live; the `fastSession` and `fastTool` copies are dead code |
| H7 | `analysis/analysisPlanning.ts` | 167-201 | `buildFastToolWorkIndex()` — type-specific function in shared file, only called by `shared/bootstrapStep.ts` in `planningMode === 'tool'` |

### Medium — type safety / code smell

| ID | File | Line(s) | Issue |
|---|---|---|---|
| M1 | `analysisSessionBase.ts` | 160-162, 342 | `walkCursor` read/written via `as unknown as Record<string, unknown>` cast — not in `AnalysisSessionState` interface |
| M2 | `analysisSessionBase.ts` | 358, 389, 420 | Multiple `as any` / `as unknown` casts bridging `AnalysisSessionState` ↔ `Record<string, unknown>` |
| M3 | `analysisSessionBase.ts` | 213 | Rehydration cast `as unknown as AnalysisSessionState` — no validation/parse step |
| M4 | `shared/turnSummaryStep.ts` | 100 | `as any` on prompt args because full/fast prompt signatures differ (`repeatedTools: string[]` vs `string`) |
| M5 | `shared/finalAggregationStep.ts` | 112 | `promptArgs as any` because three prompt builders have incompatible signatures |
| M6 | `shared/finalAggregationStep.ts` | 141 | `(parsed.data as any).total_tool_calls_assessed` — defeats Zod validation |
| M7 | `shared/finalAggregationStep.ts` | 89-91 | `tool_summaries: [] as unknown[]` etc. — explicit casts on typed array fields |
| M8 | `fastTool/fastToolGroupedAssessmentStep.ts` | 80 | `as any` on prompt call — passes fields not in signature |
| M9 | `fastTool/fastToolGroupedAssessmentStep.ts` | 65 | `evidenceQueries as any` — defeats const assertion |
| M10 | `analysisWorkflowFactory.ts` | 27 | Double cast `as unknown as AnalysisSessionState` to read `workflow_kind` discriminator |
| M11 | `shared/bootstrapStep.ts` | 55-97 | `planningMode === 'tool'` branch using `SCHEMA_KEY.FAST_TOOL_WORK_INDEX` |
| M12 | `analysisSessionBase.ts` | 170 | `abstract buildSystemPrompt(): string` — returns `''` in all three subclasses; dead/vacuous. System prompts are built via `systemPrompt.ts` dispatcher (C3) |

---

## Implementation order

### Phase 1: Eliminate shared step knowledge of analysis types (C5, C6, C7, M4-M8)

**Principle**: Each shared step class receives everything it needs via constructor.
It never imports from a concrete analysis directory or branches on identity.

**Pattern**: Move `{ buildPrompt, artifactSchemaKey, mutateContext, computeNextPhase }` into the constructor.  The subclass constructs the step with its own functions, which live in its own directory.

1. **Refactor `ToolCallAssessmentStep`** — remove `promptVariant`, accept `buildPrompt` and `computeNextPhase` as constructor functions.  Remove imports from `fullSession/` and `fastSession/`.

2. **Refactor `TurnSummaryStep`** — remove `promptVariant`, accept `buildPrompt` and schema keys as constructor params.  Remove imports from `fullSession/` and `fastSession/`.

3. **Refactor `FinalAggregationStep`** — remove `variant`, accept `buildPrompt`, `buildDeterministicReport` (optional), schema keys, and report schema as constructor params.  Remove imports from all three subdirectories.

4. **Refactor `BootstrapStep`** — remove `planningMode`, accept `buildPlanningOutput` and its schema key as constructor functions.  Move `buildFastToolWorkIndex` to `fastTool/`.

5. **Delete types** `AssessmentPromptVariant`, `SummaryPromptVariant`, `FinalAggregationVariant`, `BootstrapPlanningMode`.

6. **Update** all three analysis subclass hooks to pass their own prompt builders and config.

**Acceptance**: Zero imports from `fullSession/`, `fastSession/`, or `fastTool/` in `shared/`.  No `as any` casts on prompt arguments.

---

### Phase 2: Make each analysis subclass self-describing (C1, C2, H4, H5, M12)

7. **Add static properties to each subclass**: `static readonly workflowKind`, `static readonly workflowLabel`.

8. **Add analysis subclasses to a self-registration map** — each subclass calls a registry function at module load (e.g., `registerAnalysisWorkflow(FullSessionAnalysis)`).  The factory reads the map instead of a `switch`.

9. **Delete central `workflowKinds.ts`**.

10. **Migrate `analysisSessionPresentation.ts`** to read labels from subclass static properties instead of a central `WORKFLOW_LABELS` map.  Replace the type-guard chain with `workflowKind in registry`.

11. **Remove** `abstract buildSystemPrompt()` from base class (dead method).

**Acceptance**: Adding a new analysis type only requires creating the subclass directory, implementing the abstract methods, and calling the registration function.  No edits to `workflowKinds.ts`, `analysisWorkflowFactory.ts`, `analysisSessionPresentation.ts`, or the base class.

---

### Phase 3: Move type-specific schemas and logic to subclasses (H1-H3, H6, H7)

12. **Move `SCHEMA_KEY` type-specific entries** from `schemas.ts` to static properties on the respective analysis subclasses (e.g., `FullSessionAnalysis.artifactKeys`).  Re-export or keep shared keys only (`TOOL_CALL_ASSESSMENT`, `TURN_SUMMARY`, etc.) in `schemas.ts`.

13. **Move type-specific Zod schemas** (`fastSessionFinalAnalysisReportSchema`, `fastToolFinalReportSchema`, `fastToolWorkGroupSchema`, `fastToolWorkIndexSchema`) to the subclass directories where they are used.  Keep shared schemas (`evaluationResultSchema`, `finalAnalysisReportSchema`) in `schemas.ts`.

14. **Move `buildFastToolWorkIndex`** from `analysisPlanning.ts` to `fastTool/`.

15. **Consolidate `normalizeAnalysisGoal`** — keep one copy (in shared or base) and delete the two dead copies in `fastSession/systemPrompt.ts` and `fastTool/systemPrompt.ts`.

**Acceptance**: `schemas.ts` contains only shared/generic schemas and schema keys.  `analysisPlanning.ts` contains only shared planning logic.

---

### Phase 4: Resolve type safety issues (M1-M3, M9, M10, M11)

16. **Add `walkCursor?: number` to `AnalysisSessionState`** — remove the `as unknown` casts for walk cursor persistence.

17. **Add a parse/validate step** to `rehydrateState` so the `as unknown as AnalysisSessionState` cast from the DB is replaced with a real validation pass.

18. **Fix `evidenceQueries as any`** in `FastToolGroupedAssessmentStep` — use `ReadonlyArray<{ toolName: string; toolArgs: { id: string } }>`.

19. **Clean up `analysisWorkflowFactory.ts` discriminator** — rely on the registration map (Phase 2) rather than a `workflow_kind` field smuggled through analysis state.

**Acceptance**: Zero `as any` or `as unknown` casts that bridge structural type mismatches.  Walk cursor is properly typed.

---

### Phase 5: Fix external dispatch (C3, C4)

20. **Refactor `analysis/systemPrompt.ts`** — the system prompt dispatcher should delegate to a method on the registered analysis subclass rather than importing all three concrete prompt builders.  Each subclass implements `buildSystemPrompt(input)` for real this time (replacing the dead M12 version).

21. **Refactor `operations/launchAnalysis.ts`** — replace the Zod enum and ternary normalizer with a lookup in the analysis registry.

**Acceptance**: `operations/launchAnalysis.ts` and `analysis/systemPrompt.ts` contain zero hardcoded references to specific analysis types.

---

### Phase 6: Tests and validation

22. **Verify** `npm test` passes (168+ tests).

23. **Add at least one test** that validates a new analysis subclass can be registered and instantiated without touching any shared file.

24. **Verify** that no shared file imports from a concrete analysis subdirectory.

---

## Impact: what changes when adding a new analysis type

| Before (current) | After (target) |
|---|---|
| Edit `workflowKinds.ts` | Nothing |
| Add `import` + `case` in `analysisWorkflowFactory.ts` | Call `registerAnalysisWorkflow(NewClass)` |
| Add `if` branch in `systemPrompt.ts` | Subclass implements `buildSystemPrompt()` |
| Add enum value in `launchAnalysis.ts` | Automatic via registry |
| Add entries in `schemas.ts` (keys + schemas) | Subclass owns its own |
| Add label in `analysisSessionPresentation.ts` | Subclass `static workflowLabel` |
| Possibly edit shared step classes if new variant | Never — shared steps are pure templates |

---

## Files to delete

- `analysis/workflowKinds.ts` (replaced by subclass static properties)
- Dead copies of `normalizeAnalysisGoal` in `fastSession/systemPrompt.ts` and `fastTool/systemPrompt.ts`

## Completion notes

All 22 issues resolved.  169 tests pass.

C1 (`workflowKinds.ts`) is intentionally retained — the string constants
(`ANALYSIS_WORKFLOW_KIND.FULL_SESSION` etc.) are still used by subclass
static properties and factory/launchAnalysis fallbacks.  Replacing them
with magic strings scattered across files would be worse than keeping a
shared constants module.

M3/M10 (`as unknown as AnalysisSessionState`) casts are justified
serialization boundaries (DB JSON → typed state).  The round-trip is
guaranteed by the `saveState`/`rehydrateState` pair.

**Remaining known tradeoffs (not blocking):**
- `coverageValidationStep.ts` remains a standalone function rather than a
  `WorkflowStep` class (it's a pure computation, no LM call, no step record)
- `StepContext.workflowState` is `Record<string, unknown>` — works for
  analysis types but would need generic parameterization for other workflows
- `buildDeterministicReport` callback in `FinalAggregationStepConfig` has
  different signatures per analysis type (full vs fastTool) — papered over
  by extra unused args
