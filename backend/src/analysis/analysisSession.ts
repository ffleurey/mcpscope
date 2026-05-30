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

import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import {
  insertStepRecord,
  updateStepRecord,
  getNextStepOrdinal,
} from '../persistence/repositoryV2.js'
import {
  getLatestArtifactBySchemaKey,
} from './artifactRepository.js'
import { runBootstrapStep } from './bootstrapStep.js'
import { runToolCallAssessmentTurn } from './toolCallAssessmentTurn.js'
import { runContextMutationStep } from './contextMutationStep.js'
import { runCoverageValidationStep } from './coverageValidationStep.js'
import { runFinalAggregationTurn } from './finalAggregationTurn.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type EvidencePacketIndex,
} from './schemas.js'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

const CURSOR_STEP_TYPE = 'analysis_v2_cursor'

export interface AnalysisSessionInput {
  analysisSessionId: string
  targetSessionId: string
  targetTurnId: string
  analysisGoal: string
}

export class AnalysisSession {
  private readonly database: BackendDatabase
  private readonly lmGateway: LmStudioGateway
  private state: AnalysisSessionState
  private cursorStepId: string

  constructor(
    database: BackendDatabase,
    lmGateway: LmStudioGateway,
    input: AnalysisSessionInput,
  ) {
    this.database = database
    this.lmGateway = lmGateway
    this.cursorStepId = uuid()

    this.state = {
      phase: 'bootstrap',
      bootstrapComplete: false,
      nextPacketIndex: 0,
      packetCount: 0,
      awaitingContextMutation: false,
      pendingMutationTurnId: null,
      coverageValidated: false,
      finalAggregationComplete: false,
      analysisSessionId: input.analysisSessionId,
      targetSessionId: input.targetSessionId,
      targetTurnId: input.targetTurnId,
      analysisGoal: input.analysisGoal,
    }
  }

  /** Initialize the cursor step record in the database. */
  private initializeCursorStep(): void {
    const ordinal = getNextStepOrdinal(this.database.connection, this.state.analysisSessionId)
    insertStepRecord(this.database.connection, {
      id: this.cursorStepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: CURSOR_STEP_TYPE as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ordinal,
      status: 'running',
      params: {
        targetSessionId: this.state.targetSessionId,
        targetTurnId: this.state.targetTurnId,
        analysisGoal: this.state.analysisGoal,
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
      stepTypeKey: CURSOR_STEP_TYPE as any, // eslint-disable-line @typescript-eslint/no-explicit-any
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
      },
      state: this.state as unknown as Record<string, unknown>,
      createdAt: now(),
      completedAt: (this.state.phase === 'complete' || this.state.phase === 'error') ? now() : null,
    })
  }

  /**
   * Execute the full analysis workflow until complete or error.
   */
  async execute(): Promise<void> {
    this.initializeCursorStep()

    const MAX_ITERATIONS = 1000 // safety valve
    let iterations = 0

    while (this.state.phase !== 'complete' && this.state.phase !== 'error') {
      if (iterations++ > MAX_ITERATIONS) {
        this.state = { ...this.state, phase: 'error' }
        this.persistState()
        throw new Error('AnalysisSession: exceeded maximum iteration limit')
      }

      await this.advance()
    }
  }

  private async advance(): Promise<void> {
    const phase = this.state.phase

    if (phase === 'bootstrap') {
      await this.runBootstrap()
    } else if (phase === 'assessing') {
      await this.runNextAssessment()
    } else if (phase === 'coverage_validation') {
      this.runCoverageValidation()
    } else if (phase === 'final_aggregation') {
      await this.runFinalAggregation()
    }
    // 'complete' and 'error' are terminal — the execute() loop will stop
  }

  private async runBootstrap(): Promise<void> {
    const stepId = uuid()
    const ordinal = getNextStepOrdinal(this.database.connection, this.state.analysisSessionId)
    insertStepRecord(this.database.connection, {
      id: stepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: 'analysis_bootstrap' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ordinal,
      status: 'running',
      params: {},
      state: {},
      createdAt: now(),
      completedAt: null,
    })

    const result = await runBootstrapStep(this.database, {
      state: this.state,
      stepId,
    })

    this.state = result.updatedState

    updateStepRecord(this.database.connection, {
      id: stepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: 'analysis_bootstrap' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ordinal,
      status: 'complete',
      params: {},
      state: { packetCount: result.packetCount },
      createdAt: now(),
      completedAt: now(),
    })

    this.persistState()
  }

  private async runNextAssessment(): Promise<void> {
    const { state } = this

    if (state.awaitingContextMutation) {
      // Context mutation step
      const assessmentArtifacts = getLatestArtifactBySchemaKey(
        this.database.connection,
        state.analysisSessionId,
        SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
      )
      const assessmentArtifactId = assessmentArtifacts?.id ?? ''

      const mutationResult = runContextMutationStep(this.database, {
        state,
        assessmentArtifactId,
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
      // No more packets — move to coverage validation
      this.state = {
        ...state,
        phase: 'coverage_validation',
        awaitingContextMutation: false,
        pendingMutationTurnId: null,
      }
      this.persistState()
      return
    }

    const stepId = uuid()
    const ordinal = getNextStepOrdinal(this.database.connection, state.analysisSessionId)
    insertStepRecord(this.database.connection, {
      id: stepId,
      sessionId: state.analysisSessionId,
      stepTypeKey: 'analysis_tool_call_assessment' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ordinal,
      status: 'running',
      params: { packet_index: packet.packet_index },
      state: {},
      createdAt: now(),
      completedAt: null,
    })

    const result = await runToolCallAssessmentTurn(this.database, this.lmGateway, {
      state,
      stepId,
      packet,
      analysisTarget: targetArtifact.content as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    })

    // Advance packet index regardless of success/failure
    this.state = {
      ...result.updatedState,
      nextPacketIndex: state.nextPacketIndex + 1,
    }

    updateStepRecord(this.database.connection, {
      id: stepId,
      sessionId: state.analysisSessionId,
      stepTypeKey: 'analysis_tool_call_assessment' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ordinal,
      status: result.success ? 'complete' : 'error',
      params: { packet_index: packet.packet_index },
      state: { assessment_artifact_id: result.assessmentArtifactId },
      createdAt: now(),
      completedAt: now(),
    })

    this.persistState()
  }

  private runCoverageValidation(): void {
    const stepId = uuid()
    const ordinal = getNextStepOrdinal(this.database.connection, this.state.analysisSessionId)
    insertStepRecord(this.database.connection, {
      id: stepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: 'analysis_coverage_validation' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ordinal,
      status: 'running',
      params: {},
      state: {},
      createdAt: now(),
      completedAt: null,
    })

    const result = runCoverageValidationStep(this.database, {
      state: this.state,
      stepId,
    })

    this.state = result.updatedState

    updateStepRecord(this.database.connection, {
      id: stepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: 'analysis_coverage_validation' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ordinal,
      status: result.passed ? 'complete' : 'error',
      params: {},
      state: { passed: result.passed },
      createdAt: now(),
      completedAt: now(),
    })

    this.persistState()
  }

  private async runFinalAggregation(): Promise<void> {
    const stepId = uuid()
    const ordinal = getNextStepOrdinal(this.database.connection, this.state.analysisSessionId)
    insertStepRecord(this.database.connection, {
      id: stepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: 'analysis_final_aggregation' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ordinal,
      status: 'running',
      params: {},
      state: {},
      createdAt: now(),
      completedAt: null,
    })

    const result = await runFinalAggregationTurn(this.database, this.lmGateway, {
      state: this.state,
      stepId,
    })

    this.state = result.updatedState

    updateStepRecord(this.database.connection, {
      id: stepId,
      sessionId: this.state.analysisSessionId,
      stepTypeKey: 'analysis_final_aggregation' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ordinal,
      status: result.success ? 'complete' : 'error',
      params: {},
      state: { report_artifact_id: result.reportArtifactId },
      createdAt: now(),
      completedAt: now(),
    })

    this.persistState()
  }
}
