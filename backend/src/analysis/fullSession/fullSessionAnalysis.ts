/**
 * Full-session analysis — subclass of AnalysisSessionBase.
 *
 * Overrides 5 hooks:
 *   beforeSession  → bootstrap (discover analysis work)
 *   onToolCall     → run one tool-call assessment
 *   afterTurn      → summarise the turn's assessments
 *   afterSession   → coverage validation + final report
 */

import type { BackendDatabase } from '../../persistence/db.js'
import type { LmStudioGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import {
  AnalysisSessionBase,
  type PartInfo,
  type RoundInfo,
  type TurnInfo,
} from '../analysisSessionBase.js'
import type { AnalysisWorkflowInput } from '../analysisWorkflowInput.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvidencePacketIndex,
} from '../schemas.js'
import { ANALYSIS_WORKFLOW_KIND } from '../workflowKinds.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { BootstrapStep } from '../shared/bootstrapStep.js'
import { ToolCallAssessmentStep } from '../shared/toolCallAssessmentStep.js'
import { TurnSummaryStep } from '../shared/turnSummaryStep.js'
import { FinalAggregationStep } from '../shared/finalAggregationStep.js'
import { runCoverageValidationStep } from '../coverageValidationStep.js'

export class FullSessionAnalysis extends AnalysisSessionBase {
  static create(
    db: BackendDatabase,
    lm: LmStudioGateway,
    mcp: McpGateway,
    input: AnalysisWorkflowInput,
  ): FullSessionAnalysis {
    const state: AnalysisSessionState = {
      phase: 'bootstrap',
      bootstrapComplete: false,
      nextPacketIndex: 0,
      packetCount: 0,
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
    return new FullSessionAnalysis(db, lm, mcp, input, state)
  }

  static rehydrate(
    db: BackendDatabase,
    lm: LmStudioGateway,
    mcp: McpGateway,
    sessionId: string,
  ): FullSessionAnalysis | null {
    const state = AnalysisSessionBase.rehydrateState(db, sessionId)
    if (!state) return null
    const input: AnalysisWorkflowInput = {
      analysisSessionId: sessionId,
      targetSessionId: state.targetSessionId,
      targetTurnId: state.targetTurnId,
      analysisGoal: state.analysisGoal,
      selectedToolNames: state.selectedToolNames,
      onlyFailedToolCalls: state.onlyFailedToolCalls,
      evaluationCriteria: state.evaluationCriteria,
    }
    return new FullSessionAnalysis(db, lm, mcp, input, state)
  }

  // ── Abstract ──────────────────────────────────────────────────────────────

  protected getWorkflowKind(): string {
    return ANALYSIS_WORKFLOW_KIND.FULL_SESSION
  }

  buildSystemPrompt(): string {
    return ''
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────

  protected async beforeSession(): Promise<void> {
    if (this.state.bootstrapComplete) return

    this.emit({ type: 'analysis-phase-changed', phase: 'bootstrap' })

    await new BootstrapStep(this.db, this.lm, this.mcp, 'session')
      .execute(this.buildStepContext(STEP_TYPE.ANALYSIS_BOOTSTRAP))

    this.emit({ type: 'analysis-phase-changed', phase: this.state.phase })
  }

  protected async onToolCall(part: PartInfo, _round: RoundInfo, _turn: TurnInfo): Promise<void> {
    const indexArtifact = this.readArtifact(SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
    const targetArtifact = this.readArtifact(SCHEMA_KEY.ANALYSIS_TARGET)
    if (!indexArtifact || !targetArtifact) return

    const packetIndex = indexArtifact.content as EvidencePacketIndex
    const packet = packetIndex.packets[this.state.nextPacketIndex]
    if (!packet || packet.tool_call_part_id !== part.id) return

    await new ToolCallAssessmentStep(this.db, this.lm, this.mcp, {
      artifactSchemaKey: SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
      promptVariant: 'full',
      packet,
      analysisTarget: targetArtifact.content as AnalysisTarget,
    }).execute(this.buildStepContext(STEP_TYPE.ANALYSIS_TOOL_CALL_ASSESSMENT))
  }

  protected async afterTurn(_turn: TurnInfo): Promise<void> {
    if (!this.state.currentTurnId) return

    const indexArtifact = this.readArtifact(SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
    if (!indexArtifact) return
    const packetIndex = indexArtifact.content as EvidencePacketIndex
    if (this.state.nextPacketIndex < packetIndex.packets.length) return

    this.emit({ type: 'analysis-phase-changed', phase: 'turn_summary' })

    await new TurnSummaryStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
      summarySchemaKey: SCHEMA_KEY.TURN_SUMMARY,
      promptVariant: 'full',
    }).execute(this.buildStepContext(STEP_TYPE.ANALYSIS_TURN_SUMMARY))

    this.emit({ type: 'analysis-phase-changed', phase: this.state.phase })
  }

  protected async afterSession(): Promise<void> {
    if (this.state.finalAggregationComplete) return
    if (!this.state.coverageValidated) {
      const validated = runCoverageValidationStep(this.db, {
        state: this.state,
        stepId: this.state.analysisSessionId,
      })
      this.state = { ...this.state, ...validated.updatedState }
    }

    this.emit({ type: 'analysis-phase-changed', phase: 'final_aggregation' })

    await new FinalAggregationStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
      summarySchemaKey: SCHEMA_KEY.TURN_SUMMARY,
      reportSchemaKey: SCHEMA_KEY.FINAL_ANALYSIS_REPORT,
      variant: 'full',
    }).execute(this.buildStepContext(STEP_TYPE.ANALYSIS_FINAL_AGGREGATION))

    this.emit({ type: 'analysis-phase-changed', phase: this.state.phase })
  }
}
