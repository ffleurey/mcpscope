# Execution model refactoring: Plan + Interpret, not flatten + walk

## Status

**Draft** — architectural specification, not yet implemented.

---

## Background

The analysis workflow framework walks a target session tree to produce analysis
output (assessments of tool calls, turn summaries, final reports).  Three
concrete workflows exist, each overriding a different set of hooks:

| Workflow | File | Hooks |
|---|---|---|
| `FullSessionAnalysis` | `analysis/fullSession/fullSessionAnalysis.ts` | `beforeSession`, `onToolCall`, `afterTurn`, `afterSession` |
| `FastSessionAnalysis` | `analysis/fastSession/fastSessionAnalysis.ts` | same |
| `FastToolAnalysis` | `analysis/fastTool/fastToolAnalysis.ts` | `beforeSession`, `onToolCall`, `afterSession` |

The current architecture (`analysisSessionBase.ts`) uses a **`flatten()` + `walk()`**
loop that:

1. Calls `loadSessionTree()` to load the target session from SQLite into a
   `SessionTree` object.
2. Calls `flatten()` to turn the tree into a flat array of anonymous
   `{ methodName, fn }` callbacks — one per tree node (session, setup parts,
   steps, turns, rounds, round parts).
3. Walks the flat array with a `walkCursor` (a persisted integer index),
   calling each callback in order.
4. Each callback (hook) decides at runtime whether to actually do work, using
   ad-hoc guard booleans (`bootstrapComplete`, `nextPacketIndex` range checks,
   `finalAggregationComplete`, etc.).

The callbacks that *do* work instantiate and execute `WorkflowStep` subclasses
(Command pattern), which mutate shared state (`ctx.workflowState`) via
`Object.assign(state, ...)`.

### Known problems

These are documented in detail in `backlog/analysis-walk-cursor-reliability.md`.
Quick-fixes have been applied for surface bugs but the architectural problem
remains.

**1. No causal link between cursor position and work done.**  
`walkCursor` is a bare integer index into the flat callback list.  It cannot
answer "which packet is being assessed?" or "which turn is being summarized?".
When a `WorkflowStep` fails, the cursor has already advanced past it.  Retry
resets the cursor to 0 and replays every callback, relying on ad-hoc guards to
prevent re-execution.

**2. Three independent tracking mechanisms that can diverge.**  

| Mechanism | Location | Purpose |
|---|---|---|
| `walkCursor` | `analysisSessionBase.ts:143` | Index into the flattened callback list |
| `phase` + `nextPacketIndex` + `currentTurnId` + guards | `schemas.ts:53-85` | Semantic workflow position |
| `singleStepLimit` | `analysisSessionBase.ts:144` | External execution-slice control |

Steps mutate `phase`/`nextPacketIndex`/`currentTurnId` via `Object.assign`.
Meanwhile `walkCursor` advances independently in `walk()`.  When they get
out of sync (step errors after mutating state, tree changes between resumes)
execution becomes fragile.

**3. No mechanism to regress when the tree grows.**  
The hook list is rebuilt on every `resumeOneStep()`, but `walkCursor` is an
absolute index into the *previous* list.  New turns at the end are reachable
if the cursor hasn't passed them; new turns in the middle are invisible.
The test at `analysisSessionTree.test.ts` documents this as a known limitation.

**4. The Visitor pattern does double duty.**  
The 22 hook methods (`analysisSessionBase.ts:218-252`) serve two conflicting
purposes: (a) data collection from the target session tree and (b) workflow
orchestration.  These should be separate concerns.

---

## Design decisions

### Decision 1: The workflow is a linear sequence, not a state machine

There is no looping, branching, or non-linear transition in any analysis
workflow.  The sequence is always:

```
Bootstrap → Assess(p0) → Assess(p1) → ... → Summarize(t0) → ... → Coverage Check → Final Aggregation
```

A state machine is overkill.  The right abstraction is a **list of commands**
that is interpreted one step at a time.

### Decision 2: Separate planning from execution

- **Planning** (the Visitor pattern) traverses the target session tree and
  produces a `Command[]` — a semantic list of the work to do.
- **Execution** (the Interpreter pattern) runs one `Command` at a time by
  instantiating and executing the matching `WorkflowStep` subclass.

The Visitor is only used for data collection during planning.  It no longer
drives execution flow.

### Decision 3: Derived position instead of cursor

Instead of a persisted integer cursor, the "current position" is derived by
comparing the plan against what already exists in the database (artifacts and
step records).  A command is "complete" if its output artifact or step record
exists.  The first incomplete command is the next one to execute.

This eliminates the cursor entirely.  Position is always consistent with
actual persisted state because it's *derived from* that state.

### Decision 4: Retry by removing/re-marking artifacts

Retrying a failed step no longer resets `walkCursor: 0`.  Instead, the retry
endpoint deletes or marks as incomplete the artifacts produced by the failed
step (and any steps that depend on it).  The next `resumeOneStep()` naturally
finds the first incomplete command and picks up where work is actually needed.

### Decision 5: Keep the Command pattern for WorkflowStep

The `WorkflowStep` abstract class and its subclasses (`BootstrapStep`,
`ToolCallAssessmentStep`, `TurnSummaryStep`, etc.) remain unchanged.  These
are well-designed Commands.  The refactoring only changes *how* they are
scheduled and instantiated.

### Decision 6: Ad-hoc guard booleans are eliminated

`bootstrapComplete`, `coverageValidated`, and `finalAggregationComplete` vanish.
They were needed only because the flatten/walk loop could fire the same hook
multiple times.  With a plan list and derived-position execution, each command
runs at most once by construction.

### Decision 7: The full target session tree is loaded every step

`loadTargetTree()` no longer accepts a `targetTurnId` filter.  It loads the
entire target session tree from SQLite on every `resumeOneStep()` call.  The
`targetTurnId` field remains in state as a record of the user's original scope.

Scope filtering moves from the loader to `buildPlan()`.  The plan only includes
commands for turns up to and including `targetTurnId`.  Turns beyond the scope
are ignored.  This means new turns added *within* the scope after launch **are
automatically included** — the plan includes commands for them, and
`findFirstIncomplete()` finds the first one whose artifact doesn't exist yet.
New turns added *beyond* the original scope are not included unless the user
updates `targetTurnId` and resumes.

Completeness is decided later by `findFirstIncomplete()` scanning artifact
existence.

### Decision 8: Workflow phases are derived from the plan, not mutated by steps

`phase`, `nextPacketIndex`, `packetCount`, and `currentTurnId` are no longer
persisted in `AnalysisSessionState` or mutated by steps via `Object.assign`.
Instead, the current phase is derived by inspecting the first incomplete command's
`kind`:

| Command kind | Derived phase |
|---|---|
| `bootstrap` | `'bootstrap'` |
| `assess` | `'assessing'` |
| `turn_summary` | `'turn_summary'` |
| `coverage` | `'coverage_validation'` |
| `final_aggregation` | `'final_aggregation'` |
| *(none — all complete)* | `'complete'` |

Phase strings are kept identical to the current set (`bootstrap`, `assessing`,
`turn_summary`, `coverage_validation`, `final_aggregation`, `complete`, `error`)
to avoid breaking `analysis-phase-changed` events consumed by the API and UI.

Each command instance already carries its own identity (packet index, turn ID,
etc.) set at construction time inside `buildPlan()`.  Steps no longer need to
communicate position to each other through shared mutable state; the plan is the
communication channel.

---

## Specification

### 1. New abstractions

#### `interface AnalysisCommand`

```typescript
interface AnalysisCommand {
  /** Human-readable kind, e.g. 'bootstrap', 'assess', 'turn_summary'. */
  readonly kind: string
  /** Semantic identity within the plan, e.g. a tool_call_part_id or turn_id. */
  readonly semanticId: string
  /** StepTypeKey for the WorkflowStep that executes this command. */
  readonly stepTypeKey: string

  /** True when this command's output already exists in the DB. */
  isComplete(db: BackendDatabase, analysisSessionId: string): boolean

  /** Build a fresh WorkflowStep to execute this command. */
  buildStep(db: BackendDatabase, lm: ChatCompletionGateway, mcp: McpGateway): WorkflowStep
}
```

#### `abstract class AnalysisSessionBase` — revised interface

```typescript
export abstract class AnalysisSessionBase {
  // ── Removed ──────────────────────────────────────────────────────────────
  // hookList (was Array<{ methodName, fn }>)
  // walkCursor (was number)
  // singleStepLimit (was number | null)
  // flatten() method
  // walk() method

  // ── Kept ─────────────────────────────────────────────────────────────────
  protected readonly db, lm, mcp, sessionId, goal, state
  protected loadTargetTree(): SessionTree       // unchanged
  protected runModelTurn(prompt): Promise<string>  // unchanged
  protected writeArtifact(...), readArtifact(...), listArtifacts(...)  // unchanged
  protected buildStepContext(stepTypeKey): StepContext  // unchanged

  // ── New ──────────────────────────────────────────────────────────────────

  /** Build the complete plan of commands for this analysis session.
   *  Called fresh on every resumeOneStep() so the plan reflects the current
   *  state of the target session tree.  The Visitor pattern is used inside
   *  this method for data collection only. */
  protected abstract buildPlan(tree: SessionTree): AnalysisCommand[]

  /** Find the first incomplete command in the plan, or null if all done. */
  protected findFirstIncomplete(plan: AnalysisCommand[]): AnalysisCommand | null

  /** Execute one step: plan → find incomplete → build step → execute → persist. */
  async resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void>
  async execute(emitEvent?: AnalysisStreamEventSink): Promise<void>
  async resume(emitEvent?: AnalysisStreamEventSink): Promise<void>
  canContinue(): boolean
}
```

### 2. `buildPlan()` — replacing `flatten()`

Each subclass overrides `buildPlan()` to traverse the tree and produce a
semantic `AnalysisCommand[]`.  Artifacts are **not** read during plan
construction — they are only checked later by `findFirstIncomplete()` to
determine which commands still need execution.

#### FullSessionAnalysis plan

```
buildPlan(tree):
  commands = []
  commands.push(bootstrapCommand)
  scopeTurns = turns in tree up to and including targetTurnId
  for each turn in scopeTurns:
    for each part in turn.rounds[].parts:
      if part is a tool-call:
        commands.push(assessCommand(part))
  for each turn in scopeTurns:
    if turn has any tool-call parts:
      commands.push(summaryCommand(turn))
  commands.push(coverageCommand)
  commands.push(finalAggregationCommand)
  return commands
```

The tree is traversed for discovery.  Artifact existence is ignored here —
every tool-call part in scope gets an `AssessCommand`, every scoped turn with
tool-calls gets a `TurnSummaryCommand`.  Redundant commands (already-complete
work) are skipped later by `findFirstIncomplete()`.

This is what makes tree growth work: a new turn within scope in the tree →
`buildPlan()` produces assess + summary commands for it → `findFirstIncomplete()`
finds the first incomplete one → execution picks up on the new content.

#### FastSessionAnalysis plan

```
buildPlan(tree):
  commands = []
  commands.push(bootstrapCommand)
  scopeTurns = turns in tree up to and including targetTurnId
  for each turn in scopeTurns:
    for each part in turn.rounds[].parts:
      if part is a tool-call:
        commands.push(assessCommand(part))
  for each turn in scopeTurns:
    if turn has any tool-call parts:
      commands.push(summaryCommand(turn))
  commands.push(coverageCommand)
  commands.push(finalAggregationCommand)
  return commands
```

Same structure as FullSessionAnalysis but with fast-specific prompt builders
and schema keys passed to each command's `buildStep()`.

#### FastToolAnalysis plan

```
buildPlan(tree):
  commands = []
  commands.push(bootstrapCommand)
  commands.push(groupedAssessmentCommand)
  commands.push(finalAggregationCommand)
  return commands
```

FastToolAnalysis skips per-turn summaries (no `summaryCommand` or `coverageCommand`
— coverage is implicit in the grouped assessment).  The grouped assessment command
uses `kind: 'assess'` so `derivePhase()` maps it to `'assessing'`.

### 3. `findFirstIncomplete()` — the derived position

```typescript
protected findFirstIncomplete(plan: AnalysisCommand[]): AnalysisCommand | null {
  for (const cmd of plan) {
    if (!cmd.isComplete(this.db, this.analysisSessionId)) return cmd
  }
  return null
}
```

Each command's `isComplete()` checks DB state:

| Command | `isComplete()` checks |
|---|---|
| `bootstrap` | Artifact with `SCHEMA_KEY.EVIDENCE_PACKET_INDEX` exists for this session |
| `assess(packet)` | Artifact with the matching `assessmentSchemaKey` and `tool_call_part_id` metadata exists |
| `turn_summary(turnId)` | Artifact with the matching `summarySchemaKey` and `turn_id` metadata exists |
| `coverage` | Scans assessment artifacts and compares against the tool-call parts discovered by `buildPlan()`. Complete when every tool-call part has a matching assessment artifact. |
| `final_aggregation` | Artifact with the matching `reportSchemaKey` exists |

### 4. `resumeOneStep()` — the interpreter loop (one iteration)

```typescript
private derivePhase(plan: AnalysisCommand[], next: AnalysisCommand | null): AnalysisPhase {
  if (!next) return 'complete'
  const phaseMap: Record<string, AnalysisPhase> = {
    bootstrap: 'bootstrap',
    assess: 'assessing',
    turn_summary: 'turn_summary',
    coverage: 'coverage_validation',
    final_aggregation: 'final_aggregation',
  }
  return phaseMap[next.kind] ?? 'error'
}

async resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void> {
  this.emitFn = emitEvent

  const tree = this.loadTargetTree()
  const plan = this.buildPlan(tree)
  const next = this.findFirstIncomplete(plan)
  this.state.phase = this.derivePhase(plan, next)

  if (!next) {
    this.saveState()
    return
  }

  const step = next.buildStep(this.db, this.lm, this.mcp)
  const result = await step.execute(this.buildStepContext(next.stepTypeKey))

  // Phase is re-derived on the next resumeOneStep() call via derivePhase().
  // Steps no longer mutate shared state (phase, nextPacketIndex, etc.).
  this.saveState()

  if (result.status === 'error') {
    this.state.phase = 'error'
    this.saveState()
  }
}
```

Note: `execute()` and `resume()` still run `resumeOneStep()` in a loop, using
`canContinue()` as the loop guard.

### 5. Concrete commands

Each workflow subclass needs command implementations.  These wrap the existing
`WorkflowStep` subclasses:

```typescript
// FullSessionAnalysis commands

class BootstrapCommand implements AnalysisCommand {
  kind = 'bootstrap'
  semanticId = ''
  stepTypeKey = STEP_TYPE.ANALYSIS_BOOTSTRAP

  isComplete(db, sessionId): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, SCHEMA_KEY.EVIDENCE_PACKET_INDEX) !== null
  }

  buildStep(db, lm, mcp): WorkflowStep {
    return new BootstrapStep(db, lm, mcp, {
      indexSchemaKey: SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
    })
  }
}

class AssessCommand implements AnalysisCommand {
  kind = 'assess'
  constructor(
    readonly semanticId: string,   // tool_call_part_id
    private readonly packet: EvidencePacket,
    private readonly analysisTarget: AnalysisTarget,
  ) {}
  stepTypeKey = STEP_TYPE.ANALYSIS_TOOL_CALL_ASSESSMENT

  isComplete(db, sessionId): boolean {
    return listArtifactsBySessionAndSchemaKey(db.connection, sessionId, this.assessmentSchemaKey)
      .some(a => a.metadata.tool_call_part_id === this.semanticId)
  }

  buildStep(db, lm, mcp): WorkflowStep {
    return new ToolCallAssessmentStep(db, lm, mcp, {
      artifactSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
      buildPrompt: buildToolCallEvaluationPrompt,
      computeNextPhase: ...,
      packet: this.packet,
      analysisTarget: this.analysisTarget,
    })
  }
}

// Similar for TurnSummaryCommand, CoverageCommand, FinalAggregationCommand
```

### 6. Changes to `AnalysisSessionState`

The `walkCursor` field is removed from the state interface and all
persistence/retry paths.

```typescript
export interface AnalysisSessionState {
  phase: AnalysisPhase
  // Removed: walkCursor?: number
  // Removed: nextPacketIndex: number
  // Removed: packetCount: number
  // Removed: currentTurnId: string | null
  // Removed: bootstrapComplete: boolean
  // Removed: coverageValidated: boolean
  // Removed: finalAggregationComplete: boolean
  analysisSessionId: string
  targetSessionId: string
  targetTurnId: string
  analysisGoal: string
  selectedToolNames: string[]
  onlyFailedToolCalls: boolean
  evaluationCriteria: string[]
  workflow_kind?: string
}
```

The removed booleans become inputs to `isComplete()` checks instead.
`bootstrapComplete` → "does the evidence_packet_index artifact exist?"
`coverageValidated` → "do all packets have matching assessments?"
`finalAggregationComplete` → "does the report artifact exist?"

### 7. Changes to retry (`resetFailedAnalysisStepForRetry`)

Instead of `walkCursor: 0`, the retry endpoint:

1. Identifies the failed step record.
2. Finds the corresponding `AnalysisCommand` that produced it (by matching
   `stepTypeKey` and step params/state).
3. Deletes or marks as excluded the artifacts created by that command.
4. Deletes or marks as excluded all downstream artifacts (commands after the
   failed one in plan order), so `findFirstIncomplete()` naturally cascades
   re-execution.
5. The next `resumeOneStep()` finds the failed command as incomplete and
   re-executes it.  Downstream commands are also re-executed because their
   artifacts have been removed.

The exact artifact cleanup per command:

| Command | Artifacts to remove on retry |
|---|---|
| `bootstrap` | `evidence_packet_index`, `analysis_target`, all assessments, summaries, report |
| `assess` | That specific assessment artifact + all downstream summaries and report |
| `turn_summary` | That specific summary artifact + downstream report |
| `coverage` | Nothing (deterministic, no artifacts) — coverage is re-derived in the next `resumeOneStep()` |
| `final_aggregation` | The report artifact |

**Cascade policy**: downstream artifacts are always removed on retry.  This is
not optional — it is the only way to guarantee correctness, because a downstream
command's output (e.g. a turn summary) may have been influenced by the failed
command's output (e.g. the assessment it summarizes).  Re-running the failed
command without re-running downstream consumers would produce inconsistent state.

### 8. Changes to `resetFailedAnalysisStepForRetry` behavior

Current (simplified):

```typescript
const updatedAnalysisState = {
  ...analysisState,
  phase: retryPhase,
  walkCursor: 0,
  retry_failed_step_id: failedStep.id,
}
```

The retry endpoint does not have a live analysis instance with a plan.  It
must either **reconstruct the plan** or use **step-record metadata** as a
proxy for plan ordering.

**Option A — reconstruct the plan and derive phase (recommended):**

```typescript
// Rehydrate the analysis workflow to get its plan
const workflow = rehydrateAnalysisWorkflow(database, analysisSessionId)
const tree = loadSessionTree(database.connection, analysisSessionId)   // no targetTurnId
const plan = workflow.buildPlan(tree)

// Map step_type_key to command by matching against plan
const failedStep = getLatestErrorStep(database.connection, analysisSessionId)
const failedCommandIndex = plan.findIndex(cmd => cmd.stepTypeKey === failedStep.stepTypeKey)

// Remove artifacts from this command and all downstream
for (let i = failedCommandIndex; i < plan.length; i++) {
  removeArtifactsForCommand(database.connection, analysisSessionId, plan[i])
}

// Derive the new phase from the first remaining incomplete command.
// This avoids a stale 'error' phase persisting between retry and the next
// resumeOneStep() call.
const firstIncomplete = plan.find(cmd => {
  return !cmd.isComplete(database.connection, analysisSessionId)
})
const derivedPhase = firstIncomplete
  ? derivePhaseFromKind(firstIncomplete.kind)
  : 'complete'

const updatedAnalysisState = {
  ...analysisState,
  retry_failed_step_id: failedStep.id,
  phase: derivedPhase,
}
```

Reconstructing the plan is deterministic (no LLM calls in `buildPlan()`), so
this is safe and requires no new persisted fields.

**Cost of bootstrap retry**: retrying bootstrap removes all downstream artifacts
(assessments, summaries, report).  The next `resumeOneStep()` re-executes every
command, including all LLM calls.  This is expensive but correct — bootstrap
produces the packet index that every subsequent command depends on.  Re-running
bootstrap without re-running downstream consumers would produce inconsistent
state.

**Option B — record plan ordinal in step records (alternative):**
Add an `ordinal` field to each step record during `WorkflowStep.execute()`
that records the command's index in the plan.  The retry endpoint can then
delete all steps with `ordinal >= failedStep.ordinal` without needing to
reconstruct the plan.  Option A is preferred for keeping step records simple.

Phase is set by `derivePhase()` on the next `resumeOneStep()` — it is not
stored in the retry-persisted state.  (The `retryPhase` computation from the
current implementation is removed; the correct phase is always derived from
the first incomplete command.)

### 9. Changes to step `run()` methods (shared steps)

Steps no longer mutate shared state at all.  The `Object.assign(state, ...)`
calls inside each step's `run()` method are **removed entirely**.  State
fields (`phase`, `nextPacketIndex`, `currentTurnId`, guard booleans) are no
longer part of the persisted `AnalysisSessionState` — they are derived from
the plan.

What each step removes from its `run()` method:

| Step | Removes from `Object.assign` |
|---|---|
| `BootstrapStep.run()` | `bootstrapComplete`, `packetCount`, `phase` |
| `ToolCallAssessmentStep.run()` | `nextPacketIndex`, `currentTurnId`, `phase` |
| `TurnSummaryStep.run()` | `currentTurnId`, `phase` |
| `CoverageValidationStep.run()` | `coverageValidated`, `phase` |
| `FinalAggregationStep.run()` | `finalAggregationComplete`, `phase` |

Each step's `run()` method still performs its core work (LLM calls, artifact
writes) and returns `{ status, state }`.  The returned state diff is used
only for step-record persistence, not merged into `AnalysisSessionState`.

The only side effect a step should produce is **artifact writes**.  Everything
else (position, phase, what to do next) is derived from what artifacts exist.

**`computeNextPhase` removed**: `ToolCallAssessmentStepConfig.computeNextPhase`
was a callback for the step to determine the next phase based on `nextPacketIndex`.
Since `nextPacketIndex` is no longer present and phases are derived from the
plan, this callback is removed from the config interface and from all call sites.

### 10. Changes to `execute()` and `resume()`

These now call `resumeOneStep()` in a loop instead of `walk()`.  `canContinue()`
is derived from the plan, not from a `phase` field:

```typescript
canContinue(): boolean {
  const tree = this.loadTargetTree()   // fast — in-memory from SQLite
  const plan = this.buildPlan(tree)
  return this.findFirstIncomplete(plan) !== null
}

async execute(emitEvent?: AnalysisStreamEventSink): Promise<void> {
  this.emitFn = emitEvent
  while (this.canContinue()) {
    await this.resumeOneStep()
  }
}

async resume(emitEvent?: AnalysisStreamEventSink): Promise<void> {
  this.emitFn = emitEvent
  while (this.canContinue()) {
    await this.resumeOneStep()
  }
}
```

The duplicate loop in `execute()` vs `resume()` is preserved for backward
compatibility (callers distinguish "first run" from "resume" for eventing).

**Performance note**: `canContinue()` and `resumeOneStep()` each call
`loadTargetTree()` + `buildPlan()` independently, so each loop iteration
traverses the tree twice.  This is acceptable because both operations are
O(n) scans over in-memory SQLite results (no LLM calls).  A future
optimization could cache the plan within one `execute()`/`resume()` call
window and clear it on persistence or error.

### 11. Coverage validation design

Coverage validation is a deterministic check (no LLM call) that verifies every
tool-call part discovered by `buildPlan()` has a matching assessment artifact.

It is modeled as a real `AnalysisCommand` with a `WorkflowStep` subclass:

- **`isComplete()`**: scans assessment artifacts in the DB and compares their
  `tool_call_part_id` metadata against the tool-call parts discovered by
  `buildPlan()`.  Returns `true` when every part has a matching assessment.
- **`buildStep()`**: returns a `CoverageValidationStep` whose `run()` method
  performs the same check synchronously.  If coverage is incomplete, it writes
  a diagnostic artifact listing the missing parts and returns `{ status: 'error',
  missingParts }`.

The step record is created and persisted (with status `complete` or `error`),
giving the user an inspectable step entry for coverage status in the UI.

This design keeps the sequence linear and uniform: every command, including
coverage, produces a step record with a traceable outcome.

### 12. Removing the hook list from tests

The test at `analysisSessionTree.test.ts` was testing the side effects of
`flatten()` by measuring turn counts.  With the old `flatten()` gone, this
test is rewritten to verify that `buildPlan()` produces commands covering all
turns in the target session, and that `findFirstIncomplete()` correctly
detects new commands after a new turn is added.

```typescript
it('buildPlan includes commands for all turns in the tree', async () => {
  const tree = loadSessionTree(db, targetSessionId)   // full tree, no targetTurnId filter
  const plan = workflow.buildPlan(tree)
  const assessKinds = plan.filter(c => c.kind === 'assess')
  expect(assessKinds.length).toBe(expectedPacketCount)
})

it('findFirstIncomplete detects new commands when the tree grows', async () => {
  // Bootstrap already done — only first 2 turns exist
  const plan1 = workflow.buildPlan(tree1)
  expect(workflow.findFirstIncomplete(plan1)).toHaveKind('assess')

  // Add a 3rd turn to the target session
  addTurnToSession(db, turn3)
  const tree2 = loadSessionTree(db, targetSessionId)

  // buildPlan now includes commands for the new turn
  const plan2 = workflow.buildPlan(tree2)
  expect(plan2.some(c => c.kind === 'assess' && c.semanticId === newPacketId)).toBe(true)
  expect(workflow.findFirstIncomplete(plan2)).not.toBeNull()
})
```

---

## Files to modify

| File | What changes |
|---|---|---|
| `analysis/analysisSessionBase.ts` | Remove `hookList`, `walkCursor`, `singleStepLimit`, `flatten()`, `walk()`. Add `buildPlan()`, `findFirstIncomplete()`, `resumeOneStep()`, `derivePhase()` as specified. Simplify `execute()`/`resume()` to loop on `resumeOneStep()`. Remove `targetTurnId` from `loadTargetTree()` call. |
| `analysis/inspectionQueries.ts` | Remove `targetTurnId` parameter from `loadSessionTree()`. Remove step-slice logic — always return the full session tree. |
| `analysis/schemas.ts` | Remove `walkCursor`, `nextPacketIndex`, `packetCount`, `currentTurnId`, `bootstrapComplete`, `coverageValidated`, `finalAggregationComplete` from `AnalysisSessionState`. Keep `targetTurnId` as a record of original scope. |
| `analysis/fullSession/fullSessionAnalysis.ts` | Implement `buildPlan()` that traverses the full tree. Remove hook overrides. Remove guard checks, `computeNextPhase` closures, and `Object.assign` state mutations. |
| `analysis/fastSession/fastSessionAnalysis.ts` | Same as fullSession. |
| `analysis/fastTool/fastToolAnalysis.ts` | Implement `buildPlan()` for the fast-tool sequence (bootstrap → grouped assess → final). Remove hook overrides. Remove guard checks and `Object.assign` state mutations. |
| `analysis/shared/bootstrapStep.ts` | Remove all `Object.assign` state mutations. Core work (packet index artifact) unchanged. |
| `analysis/shared/toolCallAssessmentStep.ts` | Remove `Object.assign` state mutations and `computeNextPhase` from config and step body. Step now receives its packet identity from `buildStep()` constructor args only. |
| `analysis/shared/turnSummaryStep.ts` | Remove `Object.assign` state mutations. Step receives its turn ID from constructor config args instead of reading `state.currentTurnId`. |
| `analysis/shared/finalAggregationStep.ts` | Remove `Object.assign` state mutations. |
| `analysis/fastTool/fastToolGroupedAssessmentStep.ts` | Remove `Object.assign` state mutations. Step receives its work-unit identity from constructor config. |
| `analysis/coverageValidationStep.ts` | Convert to a `WorkflowStep` subclass with `run()` that checks coverage and writes diagnostic artifact. |
| `analysis/analysisSessionTree.test.ts` | Rewrite to test `buildPlan()` + `findFirstIncomplete()` with full-tree loading, including new-turn growth scenario. |
| `analysis/analysisWorkflow.test.ts` | Update assertions that check `walkCursor`, `nextPacketIndex`, `packetCount`, `currentTurnId` or guard booleans in persisted state. Add test for tree growth via `buildPlan()`. |
| `analysis/analysisWorkflowFactory.ts` | No structural changes. The `RehydratableAnalysisWorkflow` interface may need minor alignment if method signatures change. |
| `analysis/analysisSessionPresentation.ts` | Verify no dependency on removed state fields. `workflow_kind` and `phase` are kept. |
| `analysis/fastSession/evaluationPrompts.ts` | Remove `currentTurnId` from prompt builder parameter interfaces. The turn ID comes from the command instance, not shared state. |
| `domain/executionModel.ts` | Add `ANALYSIS_COVERAGE_VALIDATION: stepTypeKey('analysis_coverage_validation')` to `STEP_TYPE` constant. |
| `operations/launchAnalysis.ts` | Stop setting removed fields in initial state (`bootstrapComplete`, `nextPacketIndex`, `packetCount`, `currentTurnId`, `coverageValidated`, `finalAggregationComplete`). |
| `routes/sessionRoutes.ts` | Remove `walkCursor: 0` from `resetFailedAnalysisStepForRetry`. Rehydrate the analysis workflow to reconstruct the plan, then cascade artifact removal from the failed command onward. Derive and persist the correct phase from the reconstructed plan. |
| `sessionMetadata.test.ts` | Update test assertions that check for `walkCursor`, `nextPacketIndex`, `currentTurnId`, or guard booleans in the retried state. |

---

## Documentation review

The following documentation files describe the current architecture and need
updating to reflect the Plan + Interpret design.  Each file should be reviewed
and updated as part of the implementation commit.

### Files to update

| File | What to update |
|---|---|
| `ARCHITECTURE.md` | Replace description of `flatten()` + `walk()` + `walkCursor` engine with the new `buildPlan()` + `findFirstIncomplete()` + `resumeOneStep()` architecture. Update "Visitor / Hook" pattern description to note that the Visitor is now only used for data collection during planning. Add a row for the "Plan + Interpret" pattern to the design patterns table. Remove references to `walkCursor`, `hookList`, `singleStepLimit`. |
| `README.md` | If the repo map section references analysis walk mechanics, update to match. |

### No changes needed

| File | Reason |
|---|---|
| `DATA-MODEL.md` | Does not reference `AnalysisSessionState` field-level details. The session tree and record shapes are unchanged. |
| `CLI.md` | CLI behavior (launch, resume, retry) is unchanged at the operation level. |
| `MCP.md` | MCP tool behavior (analysis launch, step resume) is unchanged at the tool level. |
| `TESTING.md` | Testing strategy (regression, replay) is unchanged. Test implementation details update inside the test files. |
| `TUTORIAL.md` | User-facing workflow is the same: launch analysis, wait for completion, view results. |
| `SESSION-ANALYSIS.md` | Located in `backlog/completed/` — historical design doc, not updated. |

---

## Migration strategy

The refactoring is done in a single commit because it touches the core
execution path.  The validation criteria:

1. All existing analysis workflow tests pass (full execution, single-step,
   retry).
2. The new-turn-detection test (`analysisSessionTree.test.ts`) now passes
   instead of asserting `false`.
3. `walkCursor` no longer appears anywhere in the codebase (except possibly
   in DB migration or backward-compat read logic).
4. `bootstrapComplete`, `coverageValidated`, and `finalAggregationComplete`
   no longer appear in `AnalysisSessionState` or step `run()` methods.
5. `nextPacketIndex`, `packetCount`, and `currentTurnId` no longer appear in
   `AnalysisSessionState`.
6. `loadSessionTree()` no longer accepts or uses a `targetTurnId` parameter.
7. No `Object.assign(state, ...)` call remains in any `WorkflowStep.run()`
   method — all state derivation flows through `derivePhase()` and
   `findFirstIncomplete()`.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="read">
<｜｜DSML｜｜parameter name="filePath" string="true">/home/franck/mcpscope/backlog/execution-model-refactoring.md
