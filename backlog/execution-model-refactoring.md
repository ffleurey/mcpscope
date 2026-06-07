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

Each subclass overrides `buildPlan()` to produce the correct command sequence.

#### FullSessionAnalysis plan

```
buildPlan(tree):
  commands = []
  commands.push(bootstrapCommand)
  for each packet in evidence_packet_index:
    commands.push(assessCommand(packet))
  for each turn_id with assessments:
    commands.push(summaryCommand(turn_id))
  commands.push(coverageCommand)
  commands.push(finalAggregationCommand)
  return commands
```

Only the bootstrap command inspects the tree via the Visitor.  The rest read
from artifacts (packet index, assessments) produced by earlier commands.

#### FastToolAnalysis plan

```
buildPlan(tree):
  commands = []
  commands.push(bootstrapCommand)
  commands.push(groupedAssessmentCommand)
  commands.push(finalAggregationCommand)
  return commands
```

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
| `coverage` | No separate artifact needed — derived from whether all packets have assessments |
| `final_aggregation` | Artifact with the matching `reportSchemaKey` exists |

### 4. `resumeOneStep()` — the interpreter loop (one iteration)

```typescript
async resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void> {
  this.emitFn = emitEvent

  if (this.state.phase === 'complete' || this.state.phase === 'error') return

  const tree = this.loadTargetTree()
  const plan = this.buildPlan(tree)
  const next = this.findFirstIncomplete(plan)

  if (!next) {
    this.state.phase = 'complete'
    this.saveState()
    return
  }

  const step = next.buildStep(this.db, this.lm, this.mcp)
  const result = await step.execute(this.buildStepContext(next.stepTypeKey))

  // Sync phase from result — the step's run() method mutates workflowState
  // (this remains unchanged from the current design; phase mutations still
  // happen inside step.run() via Object.assign(state, ...)).
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
  nextPacketIndex: number
  packetCount: number
  currentTurnId: string | null
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
4. Sets `state.phase` to the phase before the failed command ran.
5. The next `resumeOneStep()` finds the failed command as incomplete and
   re-executes it.

The exact artifact cleanup per command:

| Command | Artifacts to remove on retry |
|---|---|
| `bootstrap` | `evidence_packet_index`, `analysis_target`, all subsequent assessments, summaries, report |
| `assess` | That specific assessment artifact; optionally downstream summaries/report |
| `turn_summary` | That specific summary artifact; optionally downstream report |
| `coverage` | Nothing (deterministic, no artifacts) — just regress phase |
| `final_aggregation` | The report artifact |

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

Proposed:

```typescript
const updatedAnalysisState = {
  ...analysisState,
  phase: retryPhase,
  // No walkCursor
  // Guards like bootstrapComplete are left alone — they become irrelevant
  retry_failed_step_id: failedStep.id,
}

// Remove artifacts produced by the failed step (and optionally downstream steps)
removeArtifactsForStep(database.connection, analysisSessionId, failedStep.id)
```

### 9. Changes to step `run()` methods (shared steps)

The `Object.assign(state, ...)` calls inside each step's `run()` method
**still update `phase` and `nextPacketIndex`** — that part doesn't change.
What changes is that they no longer need to set guard booleans:

| Step | Removes from `Object.assign` |
|---|---|
| `BootstrapStep.run()` | `bootstrapComplete` |
| `ToolCallAssessmentStep.run()` | *(none — already doesn't set guards)* |
| `TurnSummaryStep.run()` | *(none — already doesn't set guards)* |
| `FinalAggregationStep.run()` | `finalAggregationComplete` |

### 10. Changes to `execute()` and `resume()`

These now call `resumeOneStep()` in a loop instead of `walk()`:

```typescript
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

### 11. Changes to `coverageValidationStep.ts`

`runCoverageValidationStep()` currently returns `{ updatedState, passed }`.
Its caller (`afterSession` hook) mutates `this.state` directly.  In the new
design the coverage check becomes a deterministic helper called by a command's
`buildStep()` or checked as part of `isComplete()`.

Since coverage validation is deterministic (no LLM call), it could either:

(a) Remain a command with a trivial `buildStep()` that returns a no-op step,
    with the check happening in `isComplete()`, or
(b) Be folded into the `FinalAggregationCommand.isComplete()` logic.

Option (a) is cleaner for sequence clarity.

### 12. Removing the hook list from tests

The test at `analysisSessionTree.test.ts` was testing the side effects of
`flatten()` by measuring turn counts.  With the old `flatten()` gone, this
test is rewritten to verify that `buildPlan()` produces commands covering all
turns in the target session, and that `findFirstIncomplete()` correctly
detects new commands after a new turn is added.

```typescript
it('buildPlan includes commands for new turns added after initial bootstrap', async () => {
  const plan = workflow.buildPlan(tree)
  expect(plan.some(c => c.kind === 'assess' && c.semanticId === newPacketId)).toBe(true)
})
```

---

## Files to modify

| File | What changes |
|---|---|
| `analysis/analysisSessionBase.ts` | Remove `hookList`, `walkCursor`, `singleStepLimit`, `flatten()`, `walk()`. Add `buildPlan()`, `findFirstIncomplete()`, `resumeOneStep()` as specified. Simplify `execute()`/`resume()` to loop on `resumeOneStep()`. |
| `analysis/schemas.ts` | Remove `walkCursor`, `bootstrapComplete`, `coverageValidated`, `finalAggregationComplete` from `AnalysisSessionState`. |
| `analysis/fullSession/fullSessionAnalysis.ts` | Implement `buildPlan()`. Remove hook overrides (they become internal helpers called by `buildPlan()`). Remove guard checks. |
| `analysis/fastSession/fastSessionAnalysis.ts` | Same as fullSession. |
| `analysis/fastTool/fastToolAnalysis.ts` | Same. |
| `analysis/shared/bootstrapStep.ts` | Remove `bootstrapComplete` from `Object.assign`. |
| `analysis/shared/finalAggregationStep.ts` | Remove `finalAggregationComplete` from `Object.assign`. |
| `analysis/coverageValidationStep.ts` | No changes needed if kept as a command; or fold into `FinalAggregationCommand` |
| `analysis/analysisSessionTree.test.ts` | Rewrite to test `buildPlan()` + `findFirstIncomplete()` instead of `flatten()`. |
| `analysis/analysisWorkflow.test.ts` | Update assertions that check `walkCursor` or guard booleans in persisted state. |
| `routes/sessionRoutes.ts` | Remove `walkCursor: 0` from `resetFailedAnalysisStepForRetry`. Add artifact cleanup for the failed step. |

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
