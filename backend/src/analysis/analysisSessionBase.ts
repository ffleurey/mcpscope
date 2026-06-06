/**
 * Abstract base class for session analysis workflows.
 *
 * Subclasses override hook methods corresponding to nodes in the target session's
 * canonical runtime tree.  The base class owns tree traversal, execution-loop
 * control (run / resume / resumeOneStep), step-record lifecycle, state persistence,
 * and rehydration — so subclasses express only their analysis behaviour.
 */

import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import {
  getSessionRecord,
  updateSessionAnalysisState,
} from '../persistence/repository.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import type { AnalysisWorkflowInput } from './analysisWorkflowInput.js'
import type { StepContext } from '../workflow/stepContext.js'
import type { StepTypeKey } from '../domain/executionModel.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
  listArtifactsBySessionAndSchemaKey,
} from './artifactRepository.js'
import {
  type AnalysisSessionState,
} from './schemas.js'
import { runAnalysisTurn } from './boundedTurn.js'
import { loadSessionTree } from './inspectionQueries.js'

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
// Abstract base class
// ───────────────────────────────────────────────────────────────────────────────

export abstract class AnalysisSessionBase {
  // ── per-instance state ──────────────────────────────────────────────────────
  protected readonly db: BackendDatabase
  protected readonly lm: LmStudioGateway
  protected readonly mcp: McpGateway
  protected readonly sessionId: string
  protected readonly goal: string
  protected state: AnalysisSessionState

  private emitFn: AnalysisStreamEventSink | undefined
  protected get emitSink(): AnalysisStreamEventSink | undefined { return this.emitFn }

  // ── re-entrant walk support ─────────────────────────────────────────────────
  private hookList: Array<{ methodName: string; fn: () => Promise<void> }> | null = null
  private walkCursor = 0
  private singleStepLimit: number | null = null

  // ── constructor ─────────────────────────────────────────────────────────────
  constructor(
    db: BackendDatabase,
    lm: LmStudioGateway,
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
    this.walkCursor = initialState.walkCursor ?? 0
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Abstract — every subclass must define these
  // ────────────────────────────────────────────────────────────────────────────

  protected abstract getWorkflowKind(): string

  // ────────────────────────────────────────────────────────────────────────────
  // Public execution API
  // ────────────────────────────────────────────────────────────────────────────

  async execute(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    this.emitFn = emitEvent
    this.walkCursor = 0
    this.hookList = null
    const tree = this.loadTargetTree()
    await this.walk(tree)
  }

  async resume(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    this.emitFn = emitEvent
    this.hookList = null
    const tree = this.loadTargetTree()
    await this.walk(tree)
  }

  async resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    this.emitFn = emitEvent
    this.hookList = null
    this.singleStepLimit = 1
    const tree = this.loadTargetTree()
    await this.walk(tree)
    this.singleStepLimit = null
  }

  canContinue(): boolean {
    return this.state.phase !== 'complete' && this.state.phase !== 'error'
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
  // Hooks — 22 tree positions, each defaults to no-op
  // ────────────────────────────────────────────────────────────────────────────

  // ── Session ─────────────────────────────────────────────────────────────────
  protected async beforeSession(_s: SessionInfo): Promise<void> {}
  protected async afterSession(_s: SessionInfo): Promise<void> {}

  // ── Setup ───────────────────────────────────────────────────────────────────
  protected async beforeSetup(_s: SetupInfo): Promise<void> {}
  protected async onSystemPrompt(_p: PartInfo): Promise<void> {}
  protected async onMcpInstructions(_p: PartInfo): Promise<void> {}
  protected async onToolDefinitions(_p: PartInfo): Promise<void> {}
  protected async afterSetup(_s: SetupInfo): Promise<void> {}

  // ── Steps (generic — fires for every step) ──────────────────────────────────
  protected async beforeStep(_s: StepInfo): Promise<void> {}
  protected async afterStep(_s: StepInfo): Promise<void> {}

  // ── WorkflowStep ────────────────────────────────────────────────────────────
  protected async beforeWorkflowStep(_w: WorkflowStepInfo): Promise<void> {}
  protected async afterWorkflowStep(_w: WorkflowStepInfo): Promise<void> {}

  // ── CompactionStep ──────────────────────────────────────────────────────────
  protected async beforeCompaction(_c: CompactionInfo): Promise<void> {}
  protected async afterCompaction(_c: CompactionInfo): Promise<void> {}

  // ── Turn ────────────────────────────────────────────────────────────────────
  protected async beforeTurn(_t: TurnInfo): Promise<void> {}
  protected async afterTurn(_t: TurnInfo): Promise<void> {}

  // ── Round ───────────────────────────────────────────────────────────────────
  protected async beforeRound(_r: RoundInfo): Promise<void> {}
  protected async afterRound(_r: RoundInfo): Promise<void> {}

  // ── Round parts ─────────────────────────────────────────────────────────────
  protected async onUserPrompt(_p: PartInfo, _round: RoundInfo, _turn: TurnInfo): Promise<void> {}
  protected async onReasoning(_p: PartInfo, _round: RoundInfo, _turn: TurnInfo): Promise<void> {}
  protected async onToolCall(_p: PartInfo, _round: RoundInfo, _turn: TurnInfo): Promise<void> {}
  protected async onAssistantAnswer(_p: PartInfo, _round: RoundInfo, _turn: TurnInfo): Promise<void> {}

  // ────────────────────────────────────────────────────────────────────────────
  // Traversal engine
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Flatten the target tree into a linear list of hook descriptors.  This is
   * called once per walk; the list is cached so that `resumeOneStep` can
   * advance position-by-position without rebuilding.
   */
  private flatten(tree: SessionTree): Array<{ methodName: string; fn: () => Promise<void> }> {
    if (this.hookList) return this.hookList

    const list: Array<{ methodName: string; fn: () => Promise<void> }> = []

    list.push({ methodName: 'beforeSession', fn: () => this.beforeSession(tree.session) })

    if (tree.setup) {
      const s = tree.setup
      list.push({ methodName: 'beforeSetup', fn: () => this.beforeSetup(s) })
      for (const part of s.parts) {
        switch (part.type) {
          case 'system_prompt':     list.push({ methodName: 'onSystemPrompt', fn: () => this.onSystemPrompt(part) }); break
          case 'mcp_instructions':  list.push({ methodName: 'onMcpInstructions', fn: () => this.onMcpInstructions(part) }); break
          case 'tool_definitions':  list.push({ methodName: 'onToolDefinitions', fn: () => this.onToolDefinitions(part) }); break
        }
      }
      list.push({ methodName: 'afterSetup', fn: () => this.afterSetup(s) })
    }

    for (const step of tree.steps) {
      list.push({ methodName: 'beforeStep', fn: () => this.beforeStep(step) })

      if (step.isWorkflowStep) {
        const wf: WorkflowStepInfo = { step, ownedTurnCount: 0 }
        list.push({ methodName: 'beforeWorkflowStep', fn: () => this.beforeWorkflowStep(wf) })
        list.push({ methodName: 'afterWorkflowStep', fn: () => this.afterWorkflowStep(wf) })
      }

      if (step.isCompaction) {
        const compaction = tree.compactionDetails.get(step.id) ?? {
          step, strategy: null, strippedPartIds: [], strippedPartCount: 0,
          contextTokensBefore: null, contextTokensAfter: null, tokensRemoved: null,
        }
        list.push({ methodName: 'beforeCompaction', fn: () => this.beforeCompaction(compaction) })
        list.push({ methodName: 'afterCompaction', fn: () => this.afterCompaction(compaction) })
      }

      if (step.isTurn) {
        const turn = tree.turnDetails.get(step.id)
        if (turn) {
          list.push({ methodName: 'beforeTurn', fn: () => this.beforeTurn(turn) })
          for (const round of turn.rounds) {
            list.push({ methodName: 'beforeRound', fn: () => this.beforeRound(round) })
            for (const part of round.parts) {
              list.push({ methodName: 'onToolCall', fn: () => this.onToolCall(part, round, turn) })
            }
            list.push({ methodName: 'afterRound', fn: () => this.afterRound(round) })
          }
          list.push({ methodName: 'afterTurn', fn: () => this.afterTurn(turn) })
        }
      }

      list.push({ methodName: 'afterStep', fn: () => this.afterStep(step) })
    }

    list.push({ methodName: 'afterSession', fn: () => this.afterSession(tree.session) })

    this.hookList = list
    return list
  }

  /**
   * Walk the flattened hook list starting from `walkCursor`.
   * When `singleStepLimit` is set, the walk stops after that many advances.
   */
  private async walk(tree: SessionTree): Promise<void> {
    const list = this.flatten(tree)
    let advanced = 0

    for (let i = this.walkCursor; i < list.length; i++) {
      const item = list[i]
      if (!item) continue
      await item.fn()

      this.walkCursor = i + 1
      this.state.walkCursor = this.walkCursor
      this.saveState()

      advanced++
      if (this.singleStepLimit !== null && advanced >= this.singleStepLimit) break
    }
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
  // Infrastructure for subclasses — use these inside hooks
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
  // Target tree loading
  // ────────────────────────────────────────────────────────────────────────────

  protected loadTargetTree(): SessionTree {
    const tree = loadSessionTree(
      this.db.connection,
      this.state.targetSessionId,
      this.state.targetTurnId,
    )
    if (!tree) throw new Error(`Target session not found: ${this.state.targetSessionId}`)
    return tree
  }
}
