# Multiple Types of Analysis Sessions

Implementation task for the specification in [backlog/specification/multiple-types-of-analsysis-sessions.md](../specification/multiple-types-of-analsysis-sessions.md).

This is one implementation task with staged milestones and gates. It is not split into separate backlog tasks.

## Goal

Implement the two new analysis workflows defined in the spec:

* fast session analysis
* fast tool analysis

Do that in a way that improves the current architecture rather than adding more workflow-specific branching onto the existing `AnalysisSession` implementation.

The first iteration of the work must explicitly improve step encapsulation and context ownership so that each step owns what it adds and what it removes from the active context.

## Current implementation review

The current implementation is a strong starting point, but it is still too centered on one concrete workflow shape.

### What is already in good shape

* The backend already has a scheduler-owned execution contract with initialize, full execute, one-step execute, pause, resume, status inspection, and event streaming.
* The current full analysis workflow is already decomposed into several helper modules for bootstrap, packet assessment, turn summary, coverage validation, and final aggregation.
* Artifacts and step persistence already provide a good inspectable trail for analysis execution.
* The existing tests around the analysis helpers give enough behavioral coverage to specify target-state work precisely.

### What is not yet structured well enough

* [backend/src/analysis/analysisSession.ts](../../backend/src/analysis/analysisSession.ts) is still the controlling monolith for one specific workflow shape.
* The cursor state is still tied to one concrete phase machine instead of a workflow definition that can vary by analysis kind.
* [backend/src/runtime/schedulerDispatch.ts](../../backend/src/runtime/schedulerDispatch.ts) directly depends on one concrete `AnalysisSession` implementation.
* Context cleanup is not owned explicitly enough by the step that introduced the context. The current model still relies on session-level pending fields such as `pendingInjectPartIds`, `pendingReasoningPartIds`, and `pendingMutationTurnId`.
* Prompt and schema ownership is still concentrated in source modules in a way that will become harder to maintain as two new workflows are added.
* The current full analysis flow assumes packet-by-packet linear traversal. That is acceptable for full analysis and fast session analysis, but not for fast tool analysis.

### Main architectural conclusion

The next implementation should not add `if analysis kind === ...` branches all over the current `AnalysisSession` flow.

The next implementation should extract a workflow execution shell plus workflow-specific planning and step definitions.

## Implementation targets

By the end of this task, the codebase should support three analysis workflows:

* full session analysis
* fast session analysis
* fast tool analysis

They should all run through the same scheduler/runtime contract, but they should no longer depend on one monolithic workflow implementation.

## Implementation milestones

### Milestone 1. Extract the workflow execution shell

Target:

Create a reusable analysis workflow runner that separates:

* workflow definition
* cursor state persistence
* step execution dispatch
* common execution loop behavior
* event emission

Expected restructuring:

* Extract the generic execution loop out of [backend/src/analysis/analysisSession.ts](../../backend/src/analysis/analysisSession.ts).
* Replace direct phase branching with workflow-driven step dispatch.
* Keep the persisted cursor-step model, but make its state explicitly workflow-owned rather than hard-coded to the current full-analysis phase machine.
* Introduce an explicit workflow discriminator for analysis workflows so the scheduler and launch path can rehydrate the correct workflow implementation.

Design gate:

* The full session analysis workflow still runs end to end through the scheduler after the extraction.
* The scheduler no longer needs to know about the internal full-analysis phase machine.
* Rehydration is based on workflow identity plus persisted cursor state, not on one concrete `AnalysisSession` class.

### Milestone 2. Refactor steps around the canonical step contract

Target:

Make each step explicitly own:

* what it adds to context
* what prompt it issues, if any
* what schema it expects
* what it removes from context on completion

Expected restructuring:

* Replace the current session-level pending cleanup pattern with step-owned completion cleanup.
* The logic currently concentrated in [backend/src/analysis/contextMutationStep.ts](../../backend/src/analysis/contextMutationStep.ts) should be redistributed so that the step that created context also declares and applies the cleanup for that context when it completes.
* Where a separate deterministic cleanup helper remains useful, it should be invoked as part of a step completion contract, not as implicit cleanup owned by the next step.
* The step interface should be rich enough to support deterministic steps and LLM-backed steps without special casing the scheduler.

Design gate:

* No workflow step relies on another later step to know what to remove from context.
* The full session analysis workflow preserves current behavior while using explicit step-owned context policies.
* The code for context mutation becomes easier to read locally because ownership is attached to the step that introduced the relevant parts.

### Milestone 3. Externalize authored prompt resources

Target:

Move authored prompt text and similar workflow-authored resources out of large inline strings and into backend-owned resource files.

Expected restructuring:

* Define a clear resource layout for analysis workflow prompts.
* Keep machine-validated schemas code-owned unless a stronger reason appears during implementation.
* Replace ad hoc prompt builders with resource loading plus small interpolation helpers.

Design gate:

* Prompt text for the new workflows does not live as large inline source literals spread across many modules.
* The prompt loading mechanism is deterministic, version-controlled, and local to the backend.

### Milestone 4. Re-express full session analysis as one workflow definition

Target:

Make the current full analysis workflow a concrete implementation of the extracted workflow model rather than the de facto base implementation.

Expected restructuring:

* Define the full session workflow in terms of explicit steps and workflow state.
* Preserve current behavior for bootstrap, per-packet assessment, turn summary, coverage validation, and final aggregation.
* Ensure the final report behavior remains compatible with the current tests and inspect flows unless the spec now requires a deliberate behavior change.

Design gate:

* Full session analysis remains green through focused tests.
* The new abstractions are not fake wrappers around the old monolith; the full workflow is actually expressed through the new structure.

### Milestone 5. Implement fast session analysis

Target:

Implement the fast session analysis workflow exactly as specified.

Expected implementation:

* Reuse the same broad packet planning as full session analysis.
* Use the exact fast packet, turn summary, and final report schemas from the spec.
* Keep accepted JSON outputs in active context until final aggregation completes.
* Prefer sparse, benchmark-friendly prompts and outputs.

Design gate:

* Fast session analysis can be launched, resumed, single-stepped, and fully executed.
* Fast session analysis produces the exact artifact shapes defined in the spec.
* It does not introduce frontend-owned execution behavior.

### Milestone 6. Implement fast tool analysis

Target:

Implement the fast tool analysis workflow exactly as specified.

Expected implementation:

* Create a grouped work index with one work unit per tool name used in scope.
* Gather all relevant part references for each tool-name group.
* Run one grouped assessment step per tool-name work unit.
* Keep accepted grouped assessment JSON outputs in active context until final aggregation completes.
* Produce the exact grouped assessment and final report schemas defined in the spec.

Design gate:

* Fast tool analysis runs through the same scheduler/runtime contract as the other analysis workflows.
* The implementation proves that the workflow framework supports a materially different traversal shape from full session analysis.
* The grouped-by-tool-name work model is inspectable through persisted artifacts and steps.

## Concrete restructuring steps in code

The implementation will likely require the following concrete code moves or module splits.

## Iteration 1: First coding slice

This first iteration is the minimum structural change that should be made before adding either of the two new workflows.

It is intentionally focused on extracting the workflow execution structure and fixing step-owned context cleanup for the existing full workflow first.

### Iteration 1 objective

Re-express the current full analysis workflow so that:

* the scheduler no longer rehydrates one hard-coded `AnalysisSession` implementation as the only analysis runtime
* the workflow loop is driven by a workflow definition rather than by one monolithic phase switch
* step completion owns context cleanup for the context introduced by that step
* the full workflow still behaves the same from the outside

### Iteration 1 file-level plan

#### 1. Introduce an analysis workflow runtime layer

Current anchor:

* [backend/src/analysis/analysisSession.ts](../../backend/src/analysis/analysisSession.ts)

Required change:

* extract the generic loop, cursor-step initialization, resume, and resume-one-step behavior into a workflow runtime module
* keep the current file as a compatibility wrapper only if needed during the transition

The new runtime layer should own:

* workflow identity
* persisted workflow cursor state
* next-step dispatch
* common iteration limits and terminal handling
* step event emission hooks

#### 2. Introduce an analysis workflow definition surface

Current anchor:

* [backend/src/analysis/analysisSession.ts](../../backend/src/analysis/analysisSession.ts)
* [backend/src/analysis/schemas.ts](../../backend/src/analysis/schemas.ts)

Required change:

* define a workflow contract for analysis workflows
* the current full session analysis must become one concrete workflow definition using that contract

The workflow definition should be able to answer at least:

* what workflow kind this is
* how initial cursor state is built
* which step runs next for the current state
* how state advances after a completed step
* which step artifacts and cleanup actions are associated with the step

#### 3. Replace session-owned pending cleanup with step-owned cleanup outputs

Current anchor:

* [backend/src/analysis/contextMutationStep.ts](../../backend/src/analysis/contextMutationStep.ts)
* [backend/src/analysis/schemas.ts](../../backend/src/analysis/schemas.ts)

Required change:

* remove the current pattern where state carries `awaitingContextMutation`, `pendingMutationTurnId`, `pendingInjectPartIds`, and `pendingReasoningPartIds` as the main cleanup coordination mechanism
* replace that with explicit step completion outputs

The replacement shape should let a step declare at completion time:

* parts to exclude
* parts to downgrade to historical-only
* parts to keep active until final aggregation
* the next workflow state transition

This does not forbid a deterministic cleanup helper module, but that helper must be invoked by the step that owns the cleanup, not by an unrelated later step.

#### 4. Add workflow identity to launch and rehydration

Current anchor:

* [backend/src/operations/launchAnalysis.ts](../../backend/src/operations/launchAnalysis.ts)
* [backend/src/runtime/schedulerDispatch.ts](../../backend/src/runtime/schedulerDispatch.ts)

Required change:

* persist explicit workflow identity when an analysis session is launched
* change scheduler dispatch to rehydrate an analysis workflow instance through a workflow factory rather than through `AnalysisSession.rehydrateFromDb(...)`

The first iteration only needs to support the existing full workflow through that path, but the path itself must be general enough to host the two new workflows next.

#### 5. Preserve current step modules where practical

Current anchor:

* [backend/src/analysis/bootstrapStep.ts](../../backend/src/analysis/bootstrapStep.ts)
* [backend/src/analysis/toolCallAssessmentTurn.ts](../../backend/src/analysis/toolCallAssessmentTurn.ts)
* [backend/src/analysis/turnSummaryTurn.ts](../../backend/src/analysis/turnSummaryTurn.ts)
* [backend/src/analysis/coverageValidationStep.ts](../../backend/src/analysis/coverageValidationStep.ts)
* [backend/src/analysis/finalAggregationTurn.ts](../../backend/src/analysis/finalAggregationTurn.ts)

Required change:

* keep these modules if they still make sense as step implementations
* adapt their return values so they fit the new step contract
* move context cleanup responsibility into the relevant step completion path

The first iteration should avoid needless rewriting of the substantive full-analysis logic if the main structural goal can be achieved by changing orchestration and step contracts.

### Iteration 1 design constraints

* do not implement fast session analysis yet in this slice
* do not implement fast tool analysis yet in this slice
* do not widen CLI or MCP surface
* do not move schema validation out of code in this slice
* do not attempt to unify primary-session execution internals in the same slice unless a very small local change is sufficient

### Iteration 1 gate

Iteration 1 is complete when all of the following are true:

* full session analysis launches and executes through the scheduler using the new workflow runtime path
* the scheduler dispatch path is no longer hard-coded to one concrete `AnalysisSession` rehydration path
* the old pending cleanup fields are removed or reduced to implementation detail status rather than being the primary ownership model
* step cleanup ownership is explicit and local to the step that introduced the relevant context
* focused tests for the preserved full workflow still pass

### Iteration 1 recommended validation

At minimum, validate:

* focused analysis workflow tests in [backend/src/analysis/analysisWorkflow.test.ts](../../backend/src/analysis/analysisWorkflow.test.ts)
* focused scheduler-backed analysis execution tests in [backend/src/app.test.ts](../../backend/src/app.test.ts)
* backend typecheck after the runtime extraction

### 1. Replace one concrete analysis runner with a workflow runtime layer

Likely direction:

* keep [backend/src/analysis/analysisSession.ts](../../backend/src/analysis/analysisSession.ts) temporarily as a transition point if needed
* introduce a workflow runtime module responsible for:
* initialization of the cursor step
* resume and resume-one-step loop behavior
* persisting workflow state
* invoking the next step from a workflow definition

This is the most important structural change because everything else will be awkward until this exists.

### 2. Separate workflow definitions from step implementations

Likely direction:

* keep reusable step modules for bootstrap, assessment, summary, validation, and aggregation behavior
* add workflow-definition modules that assemble those steps into:
* full session analysis
* fast session analysis
* fast tool analysis

The full and fast session workflows should share planning where that is natural.
The fast tool workflow should reuse only the parts that still make sense once the traversal changes.

### 3. Introduce explicit step cleanup contracts

Likely direction:

* replace the current `awaitingContextMutation` and related pending cleanup fields with explicit step-completion outputs
* a step result should be able to declare:
* artifacts written
* next workflow state
* part ids to exclude or downgrade
* whether produced assistant JSON remains active in context

This is the cleanest path to fixing the encapsulation problem identified in the spec.

### 4. Decouple scheduler dispatch from one analysis implementation

Likely direction:

* [backend/src/runtime/schedulerDispatch.ts](../../backend/src/runtime/schedulerDispatch.ts) should dispatch analysis execution through a workflow rehydration factory rather than directly through `AnalysisSession.rehydrateFromDb(...)`
* that factory should select the correct workflow implementation based on persisted workflow identity

This allows the scheduler to stay universal while analysis workflows vary freely.

### 5. Extend launch and persistence with workflow identity

Likely direction:

* extend the analysis launch path in [backend/src/operations/launchAnalysis.ts](../../backend/src/operations/launchAnalysis.ts)
* make the selected analysis workflow explicit at creation time
* persist enough workflow identity in the cursor step params or session metadata to support correct rehydration and inspection

The chosen shape should avoid creating unnecessary new public surfaces beyond what the spec requires.

### 6. Create a prompt resource layout for workflow-owned prompts

Likely direction:

* group prompts by workflow and step
* keep interpolation thin and deterministic
* do not move these resources into the database

## Validation gates

The task should be validated iteratively, not only at the end.

### Gate A. Full workflow preserved after runtime extraction

Run focused tests for the existing analysis workflow and scheduler-backed execution after Milestones 1 to 4.

### Gate B. Fast session analysis end-to-end

Add focused tests for:

* launch
* bootstrap
* per-packet fast assessment schema validation
* turn summary schema validation
* final report schema validation
* step-by-step execution

### Gate C. Fast tool analysis end-to-end

Add focused tests for:

* grouped work-index construction
* grouped assessment schema validation
* final grouped report schema validation
* step-by-step execution
* grouped-by-tool-name evidence retention in context through final aggregation

### Gate D. Context ownership correctness

Add focused tests that prove:

* a step removes the context it introduced when it completes
* accepted JSON result parts remain active until final aggregation as specified
* no later unrelated step is required to infer cleanup ownership for earlier steps

## Deliverable definition

This implementation task is done when:

* the codebase contains a workflow execution structure that can host the three analysis workflows cleanly
* full session analysis still works
* fast session analysis works exactly to spec
* fast tool analysis works exactly to spec
* context ownership is step-local and explicit
* scheduler-backed execution remains the canonical execution path
* focused regression tests cover the preserved and new workflows