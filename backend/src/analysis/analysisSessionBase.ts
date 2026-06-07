/**
 * Abstract base class for session analysis workflows.
 *
 * Subclasses implement buildPlan() to produce a list of AnalysisCommands by
 * traversing the target session tree (Visitor pattern for data collection).
 * The base class interprets the plan one command at a time (Interpreter
 * pattern), instantiating the matching WorkflowStep and executing it.
 *
 * No walk cursor, no flattened hook list, no shared mutable state between
 * steps.  Position is derived from plan vs. artifact existence.
 */

import type { BackendDatabase } from '../persistence/db.js'
import type { ChatCompletionGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import {
  getSessionRecord,
  updateSessionAnalysisState,
} from '../persistence/repository.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import type { AnalysisWorkflowInput } from './analysisWorkflowInput.js'
import type { StepContext } from '../workflow/stepContext.js'
import { type StepTypeKey } from '../domain/executionModel.js'
import { WorkflowStep } from '../workflow/workflowStep.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
  listArtifactsBySessionAndSchemaKey,
} from './artifactRepository.js'
import {
  type AnalysisSessionState,
  type AnalysisPhase,
  type EvidencePacket,
} from './schemas.js'
import { runAnalysisTurn } from './boundedTurn.js'
import { loadSessionTree } from './inspectionQueries.js'
import {
  listPartRecordsBySession,
  listRoundRecordsBySession,
  listTurnRecordsBySession,
} from '../persistence/repository.js'
import type { PartRecord } from '../domain/model.js'

import crypto from 'node:crypto'
function uuid(): string { return crypto.randomUUID() }
function now(): number   { return Date.now() }

// ───────────────────────────────────────────────────────────────────────────────
// Hook context types — typed slices of the target session tree
// ───────────────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string
  title: string
  status: string
  model: { name: string; key: string }
  contextWindow: { available: number | null; used: number | null }
}

export interface SetupInfo {
  id: string
  parts: PartInfo[]
}

export interface PartInfo {
  id: string
  type: 'system_prompt' | 'mcp_instructions' | 'tool_definitions' | 'user_prompt'
       | 'reasoning' | 'tool_call' | 'assistant_answer'
  tokenCount: number | null
  contextState: string
  content?: { text?: string; json?: unknown }
  toolName?: string
  toolPayload?: { call?: unknown; result?: unknown }
}

export interface StepInfo {
  id: string
  type: string
  status: string
  childIndex: number
  /** True when this step is a Turn (LLM interaction). */
  isTurn: boolean
  /** True when this step is a Compaction. */
  isCompaction: boolean
  /** True when this step is a WorkflowStep (owns turns). */
  isWorkflowStep: boolean
}

export interface CompactionInfo {
  step: StepInfo
  strategy: string | null
  strippedPartIds: string[]
  strippedPartCount: number
  contextTokensBefore: number | null
  contextTokensAfter: number | null
  tokensRemoved: number | null
}

export interface WorkflowStepInfo {
  step: StepInfo
  ownedTurnCount: number
}

export interface TurnInfo {
  step: StepInfo
  turnNumber: number | null
  ownerStepId: string | null
  rounds: RoundInfo[]
}

export interface RoundInfo {
  id: string
  index: number
  status: string
  parts: PartInfo[]
}

export interface ToolCallContext {
  part: PartInfo
  round: RoundInfo
  turn: TurnInfo
}

// ───────────────────────────────────────────────────────────────────────────────
// Runtime tree traversal plan — indexed structure for the tree walk
// ───────────────────────────────────────────────────────────────────────────────

export interface SessionTree {
  session: SessionInfo
  setup: SetupInfo | null
  steps: StepInfo[]
  /** Maps step.id → detail (lazy-loaded). */
  turnDetails: Map<string, TurnInfo>
  compactionDetails: Map<string, CompactionInfo>
}

// ───────────────────────────────────────────────────────────────────────────────
// AnalysisCommand — a single unit of work in the execution plan
// ───────────────────────────────────────────────────────────────────────────────

export interface AnalysisCommand {
  /** Human-readable kind, e.g. 'bootstrap', 'assess', 'turn_summary'. */
  readonly kind: string
  /** Semantic identity within the plan, e.g. a tool_call_part_id or turn_id. */
  readonly semanticId: string
  /** StepTypeKey for the WorkflowStep that executes this command. */
  readonly stepTypeKey: StepTypeKey

  /** True when this command's output already exists in the DB. */
  isComplete(db: BackendDatabase, sessionId: string): boolean

  /** Build a fresh WorkflowStep to execute this command. */
  buildStep(db: BackendDatabase, lm: ChatCompletionGateway, mcp: McpGateway): WorkflowStep
}

// ───────────────────────────────────────────────────────────────────────────────
// Abstract base class
// ───────────────────────────────────────────────────────────────────────────────

export abstract class AnalysisSessionBase {
  // ── per-instance state ──────────────────────────────────────────────────────
  protected readonly db: BackendDatabase
  protected readonly lm: ChatCompletionGateway
  protected readonly mcp: McpGateway
  protected readonly sessionId: string
  protected readonly goal: string
  protected state: AnalysisSessionState

  private emitFn: AnalysisStreamEventSink | undefined
  protected get emitSink(): AnalysisStreamEventSink | undefined { return this.emitFn }

  // ── constructor ─────────────────────────────────────────────────────────────
  constructor(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    input: AnalysisWorkflowInput,
    initialState: AnalysisSessionState,
  ) {
    this.db        = db
    this.lm        = lm
    this.mcp        = mcp
    this.sessionId  = input.analysisSessionId
    this.goal       = input.analysisGoal
    this.state      = initialState
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Abstract — every subclass must define these
  // ────────────────────────────────────────────────────────────────────────────

  protected abstract getWorkflowKind(): string

  /** Build the complete plan of commands for this analysis session.
   *  Called fresh on every resumeOneStep() so the plan reflects the current
   *  state of the target session tree.  The Visitor pattern is used inside
   *  this method for data collection only. */
  protected abstract buildPlan(tree: SessionTree): AnalysisCommand[]

  // ────────────────────────────────────────────────────────────────────────────
  // Public execution API
  // ────────────────────────────────────────────────────────────────────────────

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

  async resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    this.emitFn = emitEvent

    if (this.state.phase === 'complete' || this.state.phase === 'error') return

    const tree = this.loadTargetTree()
    const plan = this.buildPlan(tree)
    const next = this.findFirstIncomplete(plan)
    this.state.phase = this.derivePhase(next)

    if (!next) {
      this.saveState()
      return
    }

    this.emit({ type: 'analysis-phase-changed', phase: this.state.phase })

    const step = next.buildStep(this.db, this.lm, this.mcp)
    const result = await step.execute(this.buildStepContext(next.stepTypeKey))

    if (result.status === 'error') {
      this.state.phase = 'error'
      this.saveState()
      return
    }

    // After a successful step, rebuild the plan and re-derive phase.
    // buildPlan() output may change when bootstrap completes (it reads the
    // packet index artifact to create assess/summary commands).
    const newTree = this.loadTargetTree()
    const newPlan = this.buildPlan(newTree)
    this.state.phase = this.derivePhase(this.findFirstIncomplete(newPlan))
    this.saveState()
  }

  canContinue(): boolean {
    if (this.state.phase === 'complete' || this.state.phase === 'error') return false
    const tree = this.loadTargetTree()
    const plan = this.buildPlan(tree)
    return this.findFirstIncomplete(plan) !== null
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Derived position — find the first incomplete command in the plan
  // ────────────────────────────────────────────────────────────────────────────

  protected findFirstIncomplete(plan: AnalysisCommand[]): AnalysisCommand | null {
    for (const cmd of plan) {
      if (!cmd.isComplete(this.db, this.sessionId)) return cmd
    }
    return null
  }

  private derivePhase(next: AnalysisCommand | null): AnalysisPhase {
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

  // ────────────────────────────────────────────────────────────────────────────
  // Rehydration static
  // ────────────────────────────────────────────────────────────────────────────

  protected static rehydrateState(
    db: BackendDatabase,
    sessionId: string,
  ): AnalysisSessionState | null {
    const s = getSessionRecord(db.connection, sessionId)
    return s?.analysisState as unknown as AnalysisSessionState ?? null
  }

  // ────────────────────────────────────────────────────────────────────────────
  // State persistence
  // ────────────────────────────────────────────────────────────────────────────

  private saveState(): void {
    updateSessionAnalysisState(
      this.db.connection,
      this.sessionId,
      this.state as unknown as Record<string, unknown>,
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Infrastructure for subclasses — use inside buildPlan helpers
  // ────────────────────────────────────────────────────────────────────────────

  /** Run a bounded LLM turn inside the analysis child session. */
  protected async runModelTurn(prompt: string): Promise<string> {
    const result = await runAnalysisTurn(
      this.db, this.lm, this.mcp,
      this.sessionId,
      prompt,
      this.emitFn,
      this.sessionId,
    )
    return result.responseText
  }

  /** Persist a JSON artifact attached to this analysis session. */
  protected writeArtifact(
    schemaKey: string,
    content: unknown,
    metadata?: Record<string, unknown>,
  ): string {
    const id = uuid()
    insertJsonArtifact(this.db.connection, {
      id,
      sessionId: this.sessionId,
      stepId: this.sessionId,
      content: content as any,
      metadata: { ...metadata, schema_key: schemaKey },
      createdAt: now(),
    })
    return id
  }

  /** Read the latest artifact for a schema key. */
  protected readArtifact(schemaKey: string): { content: unknown } | null {
    return getLatestArtifactBySchemaKey(
      this.db.connection,
      this.sessionId,
      schemaKey,
    )
  }

  /** List all artifacts for a schema key. */
  protected listArtifacts(schemaKey: string): { content: unknown }[] {
    return listArtifactsBySessionAndSchemaKey(
      this.db.connection,
      this.sessionId,
      schemaKey,
    )
  }

  /** Build a StepContext for a WorkflowStep execution. */
  protected buildStepContext(stepTypeKey: StepTypeKey): StepContext {
    return {
      sessionId: this.sessionId,
      stepTypeKey,
      ...(this.emitFn ? { emitSink: this.emitFn } : {}),
      workflowState: this.state as unknown as Record<string, unknown>,
    }
  }

  /** Emit a streaming event. */
  protected emit(event: Parameters<NonNullable<AnalysisStreamEventSink>>[0]): void {
    this.emitFn?.(event)
  }

  /** Log a diagnostic artifact. */
  protected logDiagnostic(stepType: string, errorKind: string, message: string, detail?: unknown): void {
    this.writeArtifact(
      'analysis.diagnostic.v1',
      { step_type: stepType, error_kind: errorKind, message, detail },
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Tree growth — discover tool-call parts added to the target session after
  // bootstrap ran.  Returns packets for tool-call parts whose IDs are NOT in
  // the knownPacketIds set.
  // ────────────────────────────────────────────────────────────────────────────

  protected discoverNewPackets(knownPacketIds: Set<string>): EvidencePacket[] {
    const { targetSessionId, targetTurnId, selectedToolNames, onlyFailedToolCalls } = this.state

    const allTurns = listTurnRecordsBySession(this.db.connection, targetSessionId)
    const targetTurnIndex = allTurns.findIndex(turn => turn.id === targetTurnId)
    if (targetTurnIndex === -1) return []
    const inScopeTurnIds = new Set(
      allTurns.slice(0, targetTurnIndex + 1)
        .filter(turn => turn.status === 'complete')
        .map(turn => turn.id),
    )

    const allRounds = listRoundRecordsBySession(this.db.connection, targetSessionId)
    const allParts = listPartRecordsBySession(this.db.connection, targetSessionId)

    const partsByRound = new Map<string, PartRecord[]>()
    for (const part of allParts) {
      if (!part.roundId) continue
      let bucket = partsByRound.get(part.roundId)
      if (!bucket) { bucket = []; partsByRound.set(part.roundId, bucket) }
      bucket.push(part)
    }

    const partsByTurn = new Map<string, PartRecord[]>()
    for (const part of allParts) {
      if (!part.turnId) continue
      let bucket = partsByTurn.get(part.turnId)
      if (!bucket) { bucket = []; partsByTurn.set(part.turnId, bucket) }
      bucket.push(part)
    }

    const inScopeRounds = allRounds.filter(r => inScopeTurnIds.has(r.turnId))
    const selectedToolNameSet = new Set(selectedToolNames)
    const newPackets: EvidencePacket[] = []

    for (const round of inScopeRounds) {
      const roundParts = (partsByRound.get(round.id) ?? []).sort((a, b) => a.ordinal - b.ordinal)
      const turnParts = (partsByTurn.get(round.turnId) ?? []).sort((a, b) => a.ordinal - b.ordinal)
      const toolCallParts = roundParts.filter(p => p.partType === 'tool-call' && !knownPacketIds.has(p.id))
      if (toolCallParts.length === 0) continue

      const toolResultParts = turnParts.filter(p => p.partType === 'tool-result')
      const reasoningAndContentParts = turnParts
        .filter(p => p.partType === 'assistant-reasoning' || p.partType === 'assistant-content')
        .sort((a, b) => a.ordinal - b.ordinal)

      for (const toolCallPart of toolCallParts) {
        const json = toolCallPart.payload.json as { name?: string; id?: string; arguments?: string } | null
        const toolName = json?.name ?? 'unknown'
        const toolCallParameters = json?.arguments ?? '{}'

        if (selectedToolNameSet.size > 0 && !selectedToolNameSet.has(toolName)) continue

        const toolResultPart = toolResultParts.find(tr => {
          const trj = tr.payload.json as { tool_call_id?: string } | null
          return trj?.tool_call_id ? trj.tool_call_id === json?.id : tr.roundId === round.id && tr.ordinal > toolCallPart.ordinal
        })
        if (onlyFailedToolCalls) {
          const isError = (toolResultPart?.provenanceJson as { isError?: boolean } | null)?.isError === true
          if (!isError) continue
        }

        const reasoningBeforePart = reasoningAndContentParts.findLast(p => p.ordinal < toolCallPart.ordinal) ?? null
        const afterOrdinal = toolResultPart ? toolResultPart.ordinal : toolCallPart.ordinal
        const reasoningAfterPart = reasoningAndContentParts.find(p => p.ordinal > afterOrdinal) ?? null

        newPackets.push({
          turn_id: round.turnId,
          round_id: round.id,
          tool_call_part_id: toolCallPart.id,
          tool_name: toolName,
          tool_call_parameters: toolCallParameters,
          reasoning_before_part_id: reasoningBeforePart?.id ?? null,
          tool_result_part_id: toolResultPart?.id ?? null,
          reasoning_after_part_id: reasoningAfterPart?.id ?? null,
        })
      }
    }

    return newPackets
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Target tree loading
  // ────────────────────────────────────────────────────────────────────────────

  protected loadTargetTree(): SessionTree {
    const tree = loadSessionTree(
      this.db.connection,
      this.state.targetSessionId,
    )
    if (!tree) throw new Error(`Target session not found: ${this.state.targetSessionId}`)
    return tree
  }
}
