# Session analysis consolidation

Status: implemented; awaiting manual UI verification and final closeout.

This task is the single consolidation branch for the shipped `session_analysis` workflow and the
remaining architecture-alignment cleanup around it.

The goal is not to redesign session analysis. The goal is to make the already-shipped workflow
look like a normal mcpscope backend-owned workflow instead of a special-case subsystem that still
leaks internal step names, placeholder vocabulary, and route-local semantics into other layers.

## Implementation outcome

This branch completed the planned consolidation without reopening the shipped analysis contract.

Completed outcomes:

- analysis launch now has an exported backend-owned operation contract, and `backend/src/app.ts` no longer reshapes the launch response ad hoc
- analysis execute now flows through a backend-owned streaming helper, and the HTTP route is a thinner SSE transport adapter
- `analysis.coverage_map.v1` was removed because the retained coverage state is derivable from `analysis.evidence_packet_index.v1` plus accepted `analysis.tool_call_assessment.v1` artifacts
- context mutation and coverage validation remain backend-owned workflow helpers but are no longer persisted as first-class housekeeping steps
- the default analysis UI no longer treats internal step taxonomy as the primary product view; step execution remains inspect/debug-only
- shared session-type vocabulary now reflects the currently supported runtime surface: `primary` and `session_analysis`
- focused backend helper regressions were added for bootstrap packet indexing, post-assessment context mutation, and coverage validation

Deliberately not done in this task:

- analysis execute was not promoted into the shared non-streaming operation catalog because that would have required a broader streaming-operation abstraction and wider product-surface decisions
- no backward-compatibility migration was added for old local databases that may still contain removed placeholder session types

Residual follow-up after this task:

- manual UI inspection is still useful to judge how the streamlined analysis trace reads in practice now that internal steps are demoted from the main view

## Why this task exists

The shipped direction is now correct and should be preserved:

- `session_analysis` is a real child session, not a hidden batch job
- analysis evidence is loaded through deterministic inspect turns on the restricted analysis MCP surface
- packet-local evidence is cleaned out of active context after use
- durable structured artifacts remain the backend-owned working state

That contract is already captured in `SESSION-ANALYSIS.md` and in the main backend regression:

- `backend/src/app.test.ts`
  - `v2 full flow with tool calls: produces assessment, turn_summary, and final_report artifacts via deterministic inspect turns`

What is still misaligned is the surrounding architecture:

- `backend/src/analysis/analysisSession.ts` still acts like a bespoke mini-engine with persisted step names that leak implementation detail
- `frontend/src/lib/components/AnalysisStepBlock.svelte`, `frontend/src/lib/components/ChatView.svelte`, and `frontend/src/lib/sessionStore.ts` are coupled to those analysis-internal step names and to step-by-step debugging controls
- `backend/src/domain/model.ts`, `backend/src/domain/sessionValidation.ts`, `frontend/src/lib/backendTypes.ts`, and `DATA-MODEL.md` still expose placeholder-looking session types that do not match the current shipped product posture
- analysis launch and execute semantics live partly in `backend/src/operations/launchAnalysis.ts` and `backend/src/operations/executeAnalysis.ts`, but they are not yet aligned with the exported operation surface in `backend/src/operations/`
- `backend/src/app.ts` still contains route-local shaping for analysis launch and streaming execution and remains larger than it should be

This task should clean up those leftovers without changing the shipped analysis-session behavior.

## Retained contract vs non-contract

This cleanup must start by treating some aspects of the current implementation as shipped contract and
some aspects as replaceable implementation detail.

Retained contract:

- `session_analysis` remains a real child session in the normal runtime tree
- the restricted analysis MCP surface remains read-only and restricted to inspect/status behavior
- analysis evidence remains loaded through committed deterministic inspect turns, not synthetic prompt bundles
- packet-level assessment outputs remain durable and inspectable
- the workflow still produces a durable final report
- the resulting run remains replayable and regression-testable through backend-owned seams

Not contract by default:

- the current phase names
- the current custom persisted step names
- the current frontend stepper and step-label rendering
- the current analysis-only event vocabulary beyond what is needed for backend streaming and thin UI updates
- the current artifact inventory if some artifacts are only internal bookkeeping and not real durable product value

If implementation reveals that one of the "not contract" items is actually required by existing code or
tests for a defensible product reason, keep it only with an explicit justification.

## Canonical docs and code anchors

Read these before editing:

1. `SESSION-ANALYSIS.md`
2. `ARCHITECTURE.md`
3. `DATA-MODEL.md`
4. `TESTING.md`

Start implementation from these files:

- `backend/src/analysis/analysisSession.ts`
- `backend/src/operations/launchAnalysis.ts`
- `backend/src/operations/executeAnalysis.ts`
- `backend/src/operations/index.ts`
- `backend/src/operations/catalog.ts`
- `backend/src/app.ts`
- `backend/src/domain/model.ts`
- `backend/src/domain/sessionValidation.ts`
- `backend/src/app.test.ts`
- `backend/src/sessionMetadata.test.ts`
- `frontend/src/lib/backendTypes.ts`
- `frontend/src/lib/sessionStore.ts`
- `frontend/src/lib/components/AnalysisStepBlock.svelte`
- `frontend/src/lib/components/ChatView.svelte`

## Goal

Make `session_analysis` a cleanly integrated backend-owned workflow whose public contract is the
narrow shipped invariant, not the current ad hoc implementation details.

## Pre-implementation direction

This task should start from these implementation decisions unless the coding agent finds concrete
counter-evidence in the code while working:

- keep a minimal cursor step as the durable workflow frontier for this task
- do not introduce a new artifact-backed frontier unless the retained cursor step proves unable to support clean resume and inspect behavior
- treat analysis launch as the better candidate for convergence into the exported backend operation surface
- treat analysis execute as a backend-owned streaming workflow helper unless a clean streaming-operation shape emerges without broad framework work
- assume `analysis.coverage_map.v1` is removable unless the implementation proves it still carries distinct durable product value beyond packet index + accepted assessments
- treat step-by-step execution as debug-only by default, not as part of the primary analysis-session product contract

Rationale from the current code:

- `backend/src/analysis/analysisSession.ts` already persists and rehydrates a cursor step cleanly enough for resume
- `backend/src/operations/executeAnalysis.ts` depends on that cursor step directly and does not currently need a second durable state mechanism
- `backend/src/operations/catalog.ts` and `backend/src/mcp/mcp.test.ts` currently encode a small non-streaming shared operation surface, so launch is the cleaner fit than execute for near-term contract convergence
- `backend/src/analysis/contextMutationStep.ts` and `backend/src/analysis/coverageValidationStep.ts` appear to be the only real consumers of `coverage_map`, which makes it a strong candidate for derivation rather than persistence
- `frontend/src/lib/components/ChatView.svelte` and `frontend/src/lib/components/AnalysisStepBlock.svelte` currently expose step-by-step mechanics directly in the main analysis UI, which is useful for debugging but too strong as product contract

If the coding agent overturns one of these starting decisions, the branch should document the reason explicitly in code comments, tests, or this task file.

## Scope

This task includes all of the following in one branch:

- align analysis launch and execution with the backend operation boundary already used elsewhere
- thin out `backend/src/app.ts` around analysis-specific route handling and response shaping
- reduce or isolate frontend dependence on analysis-internal step type keys and debugging-only controls
- clean up shared session-type vocabulary so public/backend/frontend/docs reflect actually supported current behavior
- preserve the shipped deterministic inspect-turn workflow, packet-local context cleanup, and durable artifacts

## Non-goals

- do not redesign the analysis report schema
- do not broaden analysis into benchmark automation or compaction product work
- do not build a generic future workflow engine for every possible child-session type
- do not add UI-heavy automation unless a very small focused UI test is the cheapest regression guard
- do not change the core shipped contract documented in `SESSION-ANALYSIS.md` unless the code already proves that contract wrong

## Ordered implementation milestones

### 1. Tighten the backend-owned analysis seam

Make analysis launch and execution read like normal backend-owned mcpscope behavior.

Required outcomes:

- `backend/src/operations/launchAnalysis.ts` should be aligned with the exported operation surface in `backend/src/operations/`
- any machine-readable launch input/output contract that is currently route-local should live with the operation, not be reshaped ad hoc in `backend/src/app.ts`
- the execute path should keep SSE streaming, but `backend/src/app.ts` should become a thin transport adapter rather than the place where analysis-specific semantics are assembled
- final trace assembly and analysis-specific event semantics should be owned by the backend operation layer or a nearby backend helper, not duplicated in route code
- if a clean exported operation shape for launch is possible, add it to the normal operation exports and catalog surface
- if execute cannot reasonably become a catalog entry without inventing a broader streaming-operation framework, keep it as a backend helper but make that boundary explicit and minimal

This milestone is about architecture alignment, not about changing user-visible workflow behavior.

Target state:

- launch has a normal backend operation contract with exported schema/types and no route-local response shaping
- execute remains streaming but reads as a thin transport wrapper over backend-owned execution and trace emission
- `backend/src/app.ts` no longer decides analysis semantics; it only parses transport input, invokes backend-owned logic, and writes HTTP/SSE output

Gate before moving to milestone 2:

- there is one obvious ownership point for launch input/output contracts
- the execute route no longer contains workflow-specific business rules beyond transport framing
- no additional analysis-specific response shape is being assembled ad hoc in `backend/src/app.ts`

Stop and escalate from this milestone if:

- bringing execute into the exported operation catalog would require a new generalized streaming operation abstraction affecting non-analysis flows
- launch cannot join the shared operation surface without immediately creating CLI/MCP product obligations that this task cannot carry cleanly

### 2. Narrow the analysis workflow contract to the real invariant

Treat the current step names as implementation detail unless they are genuinely required by the shipped contract.

Required outcomes:

- preserve the current durable artifacts and deterministic inspect-turn behavior
- preserve the cursor-driven ability to resume execution
- preserve packet-local context cleanup and final report generation
- review the persisted analysis step taxonomy in `backend/src/analysis/analysisSession.ts` and neighboring analysis step files
- keep only the step/state detail that is needed for persistence, inspectability, deterministic resume, and focused debugging
- do not let frontend behavior depend on every internal analysis step name if the narrower invariant can be expressed through cursor phase, generic step metadata, or inspect-only detail

Target direction for the cleanup:

- one minimal workflow frontier record, either as a retained cursor step or an equivalent dedicated durable record
- ordinary turns for bootstrap inspect, packet assessment, turn summaries, and final aggregation
- backend housekeeping helpers for context mutation and coverage validation where those behaviors do not need to survive as first-class persisted workflow nodes
- durable artifacts only where they carry product value rather than transient internal bookkeeping

Artifact review expectations:

- preserve `analysis.analysis_target.v1` unless a clearly better equivalent replaces it
- preserve `analysis.evidence_packet_index.v1` unless a clearly better equivalent replaces it
- preserve `analysis.tool_call_assessment.v1`
- preserve `analysis.turn_summary.v1`
- preserve `analysis.final_analysis_report.v1`
- explicitly review whether `analysis.coverage_map.v1` should survive this cleanup or be replaced by derivation from packet index + accepted assessments

A smaller internal step vocabulary is acceptable. A richer internal step vocabulary is also acceptable if it becomes backend-internal and no longer drives UI behavior directly.

Target state:

- exactly one durable workflow frontier remains for resume and inspectability
- persisted steps exist only where they carry durable user/debug value rather than internal bookkeeping convenience
- bootstrap inspect, assessment, turn-summary, and final-aggregation work remain visible through ordinary turns and durable outputs
- context mutation and coverage checks become helpers unless a retained persisted node is clearly justified
- if `coverage_map` survives, the branch must explain why it is not derivable enough to remove

Recommended implementation bias:

- retain the cursor step, minimize its state payload, and shrink the surrounding custom step taxonomy rather than inventing a new frontier mechanism

Gate before moving to milestone 3:

- the remaining durable state can be explained in one short paragraph without referencing implementation accidents
- each retained artifact and retained custom step type has a specific reason tied to resume, inspectability, or product value
- the main analysis regression still matches the intended deterministic inspect-turn flow

Stop and escalate from this milestone if:

- removing a bookkeeping artifact or step changes exported trace or replay semantics outside the analysis-session slice
- preserving resume behavior would require a broader redesign of generic step persistence instead of local cleanup

### 3. Decouple the frontend from analysis-internal step names

The frontend should not need to know the full analysis implementation taxonomy to render an analysis session coherently.

Required outcomes:

- `frontend/src/lib/components/AnalysisStepBlock.svelte` should stop hard-coding the shipped meaning of every analysis step key when that meaning can be derived from backend-owned metadata or a narrower presentation rule
- `frontend/src/lib/components/ChatView.svelte` should stop assuming that analysis progress is defined by internal step names beyond the minimum cursor/phase behavior that is intentionally part of the contract
- `frontend/src/lib/sessionStore.ts` should stop baking in analysis implementation detail where a backend event or generic trace update is enough
- decide whether step-by-step execution is still a supported inspect/debug affordance:
  - if yes, keep it explicitly as inspect/debug behavior and make sure it does not become part of the normal user-facing contract by accident
  - if no, remove the special frontend control path rather than carrying it forward as architectural debt

The preferred outcome is a thinner, more generic analysis-session viewer, not a richer special viewer.

The default analysis UI should render the same canonical session trace and durable artifacts as the rest of the product. Any retained step-by-step control should be treated as explicit debug tooling, not as the primary analysis-session interaction model.

Target state:

- the main analysis view can render coherently from canonical trace data plus at most minimal cursor-phase metadata
- the UI no longer assumes a fixed list of analysis step keys to explain workflow meaning
- if the stepper remains, it is visually and structurally secondary to the normal analysis trace view
- the session store handles analysis streaming as generic trace updates plus minimal analysis-specific completion/error handling

Gate before moving to milestone 4:

- removing or renaming an internal analysis step key would no longer break the main analysis UI
- analysis progress in the main UI is understandable without exposing the full backend step taxonomy
- any retained step button is explicitly justified as debug tooling

Stop and escalate from this milestone if:

- the frontend needs a repo-wide generalized workflow renderer before analysis can be decoupled locally
- the backend cannot provide enough generic trace/progress information without reopening the retained analysis contract

### 4. Clean up session-type vocabulary and docs

The shared session-type vocabulary should match what the repo currently supports in practice.

Required outcomes:

- review `session_compaction` and `benchmark_analysis` across:
  - `backend/src/domain/model.ts`
  - `backend/src/domain/sessionValidation.ts`
  - `frontend/src/lib/backendTypes.ts`
  - `DATA-MODEL.md`
- if those types do not have active supported runtime behavior in the current repo, remove them from the shared public vocabulary and validation surface
- if one of them must remain for a current concrete code path, keep it only with an explicit justification in code/docs instead of leaving it as an unexplained placeholder
- update docs so the runtime/session-type description matches the actual current supported state

This milestone is specifically about eliminating misleading public vocabulary during the consolidation phase.

Target state:

- shared enums, validators, docs, and frontend types describe only current supported session types or explicitly justified near-runtime placeholders
- unsupported placeholder session types do not remain in public/backend/frontend vocabulary by inertia

Gate before moving to milestone 5:

- every remaining session type has a real code path or an explicit documented justification
- `DATA-MODEL.md` and backend/frontend shared types say the same thing about supported session types

Stop and escalate from this milestone if:

- removing stale session types would require incompatible migration handling for persisted historical sessions beyond simple compatibility cleanup

### 5. Close the regression gap for backend-owned deterministic behavior

This consolidation should improve automated coverage where the workflow is backend-owned and deterministic.

Required outcomes:

- add or tighten focused tests for packet indexing and evidence selection around `backend/src/analysis/bootstrapStep.ts`
- add or tighten focused tests for post-assessment context mutation around `backend/src/analysis/contextMutationStep.ts`
- add or tighten focused tests for artifact production and failure modes around:
  - `backend/src/analysis/toolCallAssessmentTurn.ts`
  - `backend/src/analysis/turnSummaryTurn.ts`
  - `backend/src/analysis/finalAggregationTurn.ts`
- if this cleanup changes the shared backend operation surface, add or update parity tests around `backend/src/operations/` and the MCP adapter
- if analysis launch becomes part of a real shared CLI surface in this task, add corresponding CLI regression coverage
- prefer backend and typed-adapter coverage over UI-heavy automation

Preferred stretch target if it stays scoped:

- add one replay-oriented end-to-end analysis fixture so the analysis workflow is validated through the same replay seam the rest of the backend uses

Do not force this milestone into a broader testing-framework project. The target is focused regression coverage for the deterministic backend-owned slices touched by this consolidation.

Target state:

- the retained end-to-end analysis anchor remains green
- the main helper seams changed by this task each have at least one focused regression guard
- any shared-operation change is covered where parity is enforced today
- no new behavior in this task is left protected only by manual checking unless it is truly UI-only

Gate for task completion:

- focused tests cover the chosen durable-state shape, operation boundary changes, and vocabulary cleanup
- backend typecheck and frontend typecheck pass after the cleanup

Stop and escalate from this milestone if:

- replay coverage would require building new generic replay infrastructure rather than adding one local analysis fixture
- CLI coverage would require designing a new analysis CLI surface that is not otherwise part of this task

## Milestone execution order

Implementation should follow this order and validate after each stage:

1. backend seam alignment
2. durable-state/workflow simplification
3. frontend decoupling
4. session-type vocabulary cleanup
5. focused regression expansion and doc sync

Do not start the next milestone until the previous one meets its gate or is explicitly escalated.

## Acceptance criteria

This task is complete when all of the following are true:

- the regression anchor in `backend/src/app.test.ts`
  - `v2 full flow with tool calls: produces assessment, turn_summary, and final_report artifacts via deterministic inspect turns`
  still passes without weakening its assertions
- the retained analysis contract is explicit in code/docs after the cleanup, and non-contract implementation details are no longer treated as public surface by accident
- analysis launch semantics are backend-owned and exported consistently enough that `backend/src/app.ts` no longer owns ad hoc analysis response shaping
- the analysis execute route is a thin SSE transport adapter over backend-owned execution logic
- the workflow durable state is reduced to the minimum necessary for resume, inspectability, and product value
- any retained bookkeeping artifact or custom step type has an explicit justification
- the frontend no longer depends on the full internal analysis step taxonomy to render analysis progress
- any retained step-by-step debugging behavior is clearly inspect/debug-only and not accidental product surface
- shared session-type vocabulary no longer advertises unsupported placeholder types without explicit justification
- `SESSION-ANALYSIS.md` and `DATA-MODEL.md` remain consistent with the shipped code after the cleanup
- the resulting branch is still one coherent PR rather than a partial cleanup followed by obvious deferred rewrites

## Validation

Prefer focused backend validation over UI-heavy automation.

Required validation:

1. `npx vitest run backend/src/app.test.ts -t "v2 full flow with tool calls: produces assessment, turn_summary, and final_report artifacts via deterministic inspect turns" --reporter=dot`
2. focused regression coverage for the touched backend-owned contract:
  - add or update focused tests around analysis launch/execute boundary behavior if the current anchor does not cover the refactor sufficiently
  - add or update focused tests for packet indexing, context mutation, and artifact/failure handling in the touched analysis helpers
  - add or update focused tests for session-type validation or metadata rules if vocabulary changes land
  - add or update operation/MCP parity tests if analysis launch/execute join the shared operation surface
  - add CLI coverage only if this task actually adds or changes a real CLI surface for analysis
3. `npm run check:backend`
4. `npm run check`

If a tiny focused frontend test is the cheapest way to lock in decoupling, it is allowed, but frontend-heavy automation is not the priority for this task.

Validation completed on this branch:

1. `npx vitest run backend/src/app.test.ts --reporter=json --outputFile .tmp-app-vitest.json`
2. `npx vitest run backend/src/analysis/analysisWorkflow.test.ts backend/src/sessionMetadata.test.ts --reporter=dot`
3. `npm run check:backend`
4. `npm run check`

The main backend regression completed with 8 suites passed and 75 tests passed. The focused helper and metadata rerun completed with 2 files passed and 29 tests passed.

## Stop and escalate gates

The coding agent should stop and move this back to specification instead of silently broadening scope if any of these become true:

- analysis execute cannot be aligned cleanly without first designing a repo-wide generic streaming-operation framework that would affect unrelated send/prelude flows
- session-type cleanup requires a real persistence migration or backward-compatibility policy for historic data beyond simple enum/schema/doc cleanup
- reducing the workflow to minimum durable state would require changing replay/export semantics more broadly than the analysis-session slice
- removing frontend coupling to analysis step names requires inventing a new generalized step-rendering architecture for all workflows rather than a local analysis-session cleanup
- the analysis workflow cannot be simplified or isolated without reopening the shipped contract in `SESSION-ANALYSIS.md`
- the change naturally breaks into multiple independently reviewable PRs with different risk profiles

If escalation is needed, stop after landing only the smallest already-safe local cleanup, document the blocker, and hand back a follow-up specification prompt instead of continuing to expand the branch.

## Expected result

After this task:

- `session_analysis` remains the same shipped workflow from a product perspective
- its backend seam is more consistent with the rest of mcpscope
- its frontend rendering is less coupled to internal workflow machinery
- its session-type vocabulary is less misleading
- the repo is in a better consolidation state for future work without reopening analysis-session direction