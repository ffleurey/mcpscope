/**
 * AnalysisSession
 *
 * Orchestrates the backend-owned analysis v2 workflow.
 * Implements a simple execute() loop that steps through:
 *   1. BootstrapStep  — reads target session, builds packet index & artifacts
 *   2. ToolCallAssessmentTurn + ContextMutationStep  — one per packet
 *   3. CoverageValidationStep  — verifies all packets assessed
 *   4. FinalAggregationTurn  — synthesizes final report
 *
 * State is stored persistently in v2_steps using a cursor step record so the
 * session can be inspected after completion or failure.
 */

import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import {
  insertStepRecord,
  updateStepRecord,
  getNextStepOrdinal,
  listStepRecordsBySession,
} from '../persistence/repositoryV2.js'
import type { StepPersistenceRecord } from '../domain/persistenceContract.js'
import { stepTypeKey as mkStepTypeKey } from '../domain/executionModel.js'
import { formatStepId } from '../domain/hierarchicalIds.js'
import {
  getLatestArtifactBySchemaKey,
} from './artifactRepository.js'
import { runBootstrapStep } from './bootstrapStep.js'
import { runToolCallAssessmentTurn } from './toolCallAssessmentTurn.js'
import { runContextMutationStep } from './contextMutationStep.js'
import { runCoverageValidationStep } from './coverageValidationStep.js'
import { runTurnSummaryTurn } from './turnSummaryTurn.js'
import { runFinalAggregationTurn } from './finalAggregationTurn.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type EvidencePacketIndex,
} from './schemas.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'

function now(): number {
  return Date.now()
}

const CURSOR_STEP_TYPE = 'analysis_v2_cursor'

export interface AnalysisSessionInput {
  analysisSessionId: string
  targetSessionId: string
  targetTurnId: string
  analysisGoal: string
  selectedToolNames: string[]
  onlyFailedToolCalls: boolean
  evaluationCriteria: string[]
}

export class AnalysisSession {
  private readonly database: BackendDatabase
  private readonly lmGateway: LmStudioGateway
  private readonly mcpGateway: McpGateway
  private state: AnalysisSessionState
  private cursorStepId: string

  constructor(
    database: BackendDatabase,
    lmGateway: LmStudioGateway,
    mcpGateway: McpGateway,
    input: AnalysisSessionInput,
  ) {
    this.database = database
    this.lmGateway = lmGateway
    this.mcpGateway = mcpGateway
    this.cursorStepId = '' // set in initializeCursorStep()

    this.state = {
      phase: 'bootstrap',
      bootstrapComplete: false,
      nextPacketIndex: 0,
      packetCount: 0,
      awaitingContextMutation: false,
      pendingMutationTurnId: null,
      pendingInjectPartIds: [],
      pendingReasoningPartIds: [],
      currentTurnId: null,
      coverageValidated: false,
      finalAggregationComplete: false,
      analysisSessionId: input.analysisSessionId,
      targetSessionId: input.targetSessionId,
      targetTurnId: input.targetTurnId,
      analysisGoal: input.analysisGoal,
      selectedToolNames: input.selectedToolNames,
      onlyFailedToolCalls: input.onlyFailedToolCalls,
      evaluationCriteria: input.evaluationCriteria,
    }
  }

  /** Initialize the cursor step record in the database. */
  initializeCursorStep(): void {
    const ordinal = getNextStepOrdinal(this.database.connection, this.state.analysisSessionId)
    this.cursorStepId = formatStepId(this.state.analysisSessionId, ordinal)
    insertStepRecord(this.database.connection, {
      id: this.cursorStepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: mkStepTypeKey(CURSOR_STEP_TYPE),
      ordinal,
      status: 'running',
      params: {
        targetSessionId: this.state.targetSessionId,
        targetTurnId: this.state.targetTurnId,
        analysisGoal: this.state.analysisGoal,
        selectedToolNames: this.state.selectedToolNames,
        onlyFailedToolCalls: this.state.onlyFailedToolCalls,
        evaluationCriteria: this.state.evaluationCriteria,
      },
      state: this.state as unknown as Record<string, unknown>,
      createdAt: now(),
      completedAt: null,
    })
  }

  /** Persist the current state to the cursor step record. */
  private persistState(): void {
    updateStepRecord(this.database.connection, {
      id: this.cursorStepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: mkStepTypeKey(CURSOR_STEP_TYPE),
      ordinal: 0, // not changed by updateStepRecord
      status: this.state.phase === 'complete'
        ? 'complete'
        : this.state.phase === 'error'
          ? 'error'
          : 'running',
      params: {
        targetSessionId: this.state.targetSessionId,
        targetTurnId: this.state.targetTurnId,
        analysisGoal: this.state.analysisGoal,
        selectedToolNames: this.state.selectedToolNames,
        onlyFailedToolCalls: this.state.onlyFailedToolCalls,
        evaluationCriteria: this.state.evaluationCriteria,
      },
      state: this.state as unknown as Record<string, unknown>,
      createdAt: now(),
      completedAt: (this.state.phase === 'complete' || this.state.phase === 'error') ? now() : null,
    })
  }

  /**
   * Execute the full analysis workflow until complete or error.
   * Emits SSE-style events via the optional callback for live UI updates.
   */
  async execute(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    this.initializeCursorStep()

    const MAX_ITERATIONS = 1000 // safety valve
    let iterations = 0

    while (this.state.phase !== 'complete' && this.state.phase !== 'error') {
      if (iterations++ > MAX_ITERATIONS) {
        this.state = { ...this.state, phase: 'error' }
        this.persistState()
        throw new Error('AnalysisSession: exceeded maximum iteration limit')
      }

      await this.advance(emitEvent)
    }
  }

  /**
   * Resume execution from persisted cursor state (for the separate execute endpoint).
   * Reads the cursor step from the DB by analysisSessionId and continues from the
   * current phase.
   */
  static rehydrateFromDb(
    database: BackendDatabase,
    lmGateway: LmStudioGateway,
    mcpGateway: McpGateway,
    analysisSessionId: string,
  ): AnalysisSession | null {
    const steps = listStepRecordsBySession(database.connection, analysisSessionId)
    const cursorStep = steps.find(s => s.stepTypeKey === CURSOR_STEP_TYPE)
    if (!cursorStep) return null

    const instance = new AnalysisSession(database, lmGateway, mcpGateway, {
      analysisSessionId,
      targetSessionId: '',
      targetTurnId: '',
      analysisGoal: '',
      selectedToolNames: [],
      onlyFailedToolCalls: false,
      evaluationCriteria: [],
    })
    instance.cursorStepId = cursorStep.id
    instance.state = cursorStep.state as unknown as AnalysisSessionState
    return instance
  }

  /**
   * Resume an already-initialized session (cursor step exists in DB).
   * Continues execution from the current phase without re-initializing the cursor.
   */
  async resume(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    const MAX_ITERATIONS = 1000
    let iterations = 0

    while (this.state.phase !== 'complete' && this.state.phase !== 'error') {
      if (iterations++ > MAX_ITERATIONS) {
        this.state = { ...this.state, phase: 'error' }
        this.persistState()
        throw new Error('AnalysisSession: exceeded maximum iteration limit')
      }
      await this.advance(emitEvent)
    }
  }

  /**
   * Advance the workflow by exactly one step (one call to advance()), then stop.
   * Used by the step-by-step debug mode in the frontend.
   */
  async resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    if (this.state.phase === 'complete' || this.state.phase === 'error') return
    await this.advance(emitEvent)
  }

  canContinue(): boolean {
    return this.state.phase !== 'complete' && this.state.phase !== 'error'
  }

  private async advance(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    const phase = this.state.phase

    if (phase === 'bootstrap') {
      await this.runBootstrap(emitEvent)
    } else if (phase === 'assessing') {
      await this.runNextAssessment(emitEvent)
    } else if (phase === 'turn_summary') {
      await this.runTurnSummary(emitEvent)
    } else if (phase === 'coverage_validation') {
      this.runCoverageValidation(emitEvent)
    } else if (phase === 'final_aggregation') {
      await this.runFinalAggregation(emitEvent)
    }
    // 'complete' and 'error' are terminal — the loop will stop
  }

  private async runBootstrap(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    const ordinal = getNextStepOrdinal(this.database.connection, this.state.analysisSessionId)
    const stepId = formatStepId(this.state.analysisSessionId, ordinal)
    const startedAt = now()
    const stepRecord: StepPersistenceRecord = {
      id: stepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: mkStepTypeKey('analysis_bootstrap'),
      ordinal,
      status: 'running',
      params: {},
      state: {},
      createdAt: startedAt,
      completedAt: null,
    }
    insertStepRecord(this.database.connection, stepRecord)
    emitEvent?.({ type: 'analysis-step-started', step: { ...stepRecord } })
    emitEvent?.({ type: 'analysis-phase-changed', phase: 'bootstrap' })

    const result = await runBootstrapStep(this.database, this.mcpGateway, {
      state: this.state,
      stepId,
    }, emitEvent)

    this.state = result.updatedState

    const completedStep: StepPersistenceRecord = {
      ...stepRecord,
      status: 'complete',
      state: { packetCount: result.packetCount },
      completedAt: now(),
    }
    updateStepRecord(this.database.connection, completedStep)
    emitEvent?.({ type: 'analysis-step-completed', step: completedStep })
    emitEvent?.({ type: 'analysis-phase-changed', phase: this.state.phase })

    this.persistState()
  }

  private async runTurnSummary(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    const ordinal = getNextStepOrdinal(this.database.connection, this.state.analysisSessionId)
    const stepId = formatStepId(this.state.analysisSessionId, ordinal)
    const startedAt = now()
    const stepRecord: StepPersistenceRecord = {
      id: stepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: mkStepTypeKey('analysis_turn_summary'),
      ordinal,
      status: 'running',
      params: { turn_id: this.state.currentTurnId },
      state: {},
      createdAt: startedAt,
      completedAt: null,
    }
    insertStepRecord(this.database.connection, stepRecord)
    emitEvent?.({ type: 'analysis-step-started', step: { ...stepRecord } })
    emitEvent?.({ type: 'analysis-phase-changed', phase: 'turn_summary' })

    const result = await runTurnSummaryTurn(this.database, this.lmGateway, this.mcpGateway, {
      state: this.state,
      stepId,
    }, emitEvent)
    this.state = result.updatedState

    const completedStep: StepPersistenceRecord = {
      ...stepRecord,
      status: result.success ? 'complete' : 'error',
      state: { summary_artifact_id: result.summaryArtifactId },
      completedAt: now(),
    }
    updateStepRecord(this.database.connection, completedStep)
    emitEvent?.({ type: 'analysis-step-completed', step: completedStep })
    emitEvent?.({ type: 'analysis-phase-changed', phase: this.state.phase })

    this.persistState()
  }

  private async runNextAssessment(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    const { state } = this

    if (state.awaitingContextMutation) {
      const mutationResult = runContextMutationStep(this.database, {
        state,
      })
      this.state = mutationResult.updatedState
      this.persistState()
      return
    }

    // Assessment turn
    const packetIndexArtifact = getLatestArtifactBySchemaKey(
      this.database.connection,
      state.analysisSessionId,
      SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
    )
    const targetArtifact = getLatestArtifactBySchemaKey(
      this.database.connection,
      state.analysisSessionId,
      SCHEMA_KEY.ANALYSIS_TARGET,
    )
    if (!packetIndexArtifact || !targetArtifact) {
      this.state = { ...state, phase: 'error' }
      this.persistState()
      return
    }

    const packetIndex = packetIndexArtifact.content as EvidencePacketIndex
    const packet = packetIndex.packets[state.nextPacketIndex]
    if (!packet) {
      // No more packets in this turn — the contextMutationStep already
      // transitioned to turn_summary; this path should not be reached normally.
      // As a safety fallback, transition to turn_summary if still in assessing.
      this.state = {
        ...state,
        phase: 'turn_summary',
        awaitingContextMutation: false,
        pendingMutationTurnId: null,
      }
      this.persistState()
      return
    }

    const ordinal = getNextStepOrdinal(this.database.connection, state.analysisSessionId)
    const stepId = formatStepId(state.analysisSessionId, ordinal)
    const startedAt = now()
    const assessStep: StepPersistenceRecord = {
      id: stepId,
      sessionId: state.analysisSessionId,
      stepTypeKey: mkStepTypeKey('analysis_tool_call_assessment'),
      ordinal,
      status: 'running',
      params: { tool_call_part_id: packet.tool_call_part_id },
      state: {},
      createdAt: startedAt,
      completedAt: null,
    }
    insertStepRecord(this.database.connection, assessStep)
    emitEvent?.({ type: 'analysis-step-started', step: { ...assessStep } })

    const result = await runToolCallAssessmentTurn(this.database, this.lmGateway, this.mcpGateway, {
      // Set currentTurnId from this packet's turn when entering a new turn boundary.
      // (Previously turn_inject set this; now the assessment phase owns it.)
      state: state.currentTurnId === packet.turn_id ? state : { ...state, currentTurnId: packet.turn_id },
      stepId,
      packet,
      analysisTarget: targetArtifact.content as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    }, emitEvent)

    // Advance packet index regardless of success/failure
    this.state = {
      ...result.updatedState,
      nextPacketIndex: state.nextPacketIndex + 1,
    }

    const completedAssessStep: StepPersistenceRecord = {
      ...assessStep,
      status: result.success ? 'complete' : 'error',
      state: { assessment_artifact_id: result.assessmentArtifactId },
      completedAt: now(),
    }
    updateStepRecord(this.database.connection, completedAssessStep)
    emitEvent?.({ type: 'analysis-step-completed', step: completedAssessStep })

    this.persistState()
  }

  private runCoverageValidation(emitEvent?: AnalysisStreamEventSink): void {
    const result = runCoverageValidationStep(this.database, {
      state: this.state,
      stepId: this.cursorStepId,
    })

    this.state = result.updatedState
    emitEvent?.({ type: 'analysis-phase-changed', phase: this.state.phase })

    this.persistState()
  }

  private async runFinalAggregation(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    const ordinal = getNextStepOrdinal(this.database.connection, this.state.analysisSessionId)
    const stepId = formatStepId(this.state.analysisSessionId, ordinal)
    const startedAt = now()
    const stepRecord: StepPersistenceRecord = {
      id: stepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: mkStepTypeKey('analysis_final_aggregation'),
      ordinal,
      status: 'running',
      params: {},
      state: {},
      createdAt: startedAt,
      completedAt: null,
    }
    insertStepRecord(this.database.connection, stepRecord)
    emitEvent?.({ type: 'analysis-step-started', step: { ...stepRecord } })
    emitEvent?.({ type: 'analysis-phase-changed', phase: 'final_aggregation' })

    const result = await runFinalAggregationTurn(this.database, this.lmGateway, this.mcpGateway, {
      state: this.state,
      stepId,
    }, emitEvent)

    this.state = result.updatedState

    const completedStep: StepPersistenceRecord = {
      ...stepRecord,
      status: result.success ? 'complete' : 'error',
      state: { report_artifact_id: result.reportArtifactId },
      completedAt: now(),
    }
    updateStepRecord(this.database.connection, completedStep)
    emitEvent?.({ type: 'analysis-step-completed', step: completedStep })
    emitEvent?.({ type: 'analysis-phase-changed', phase: this.state.phase })

    this.persistState()
  }
}
