/**
 * Fast-session analysis — subclass of AnalysisSessionBase.
 */

import type { BackendDatabase } from '../../persistence/db.js'
import type { ChatCompletionGateway } from '../../runtime/modelTurns.js'
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
  type EvidencePacketIndex,
  type AnalysisTarget,
} from '../schemas.js'
import { SCHEMA_KEY as SELF_KEY } from './schemas.js'
import { ANALYSIS_WORKFLOW_KIND } from '../workflowKinds.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { BootstrapStep } from '../shared/bootstrapStep.js'
import { ToolCallAssessmentStep } from '../shared/toolCallAssessmentStep.js'
import { TurnSummaryStep } from '../shared/turnSummaryStep.js'
import { FinalAggregationStep } from '../shared/finalAggregationStep.js'
import { runCoverageValidationStep } from '../coverageValidationStep.js'
import { buildFastSessionSystemPrompt } from './systemPrompt.js'
import { buildFastSessionToolCallAssessmentPrompt } from './evaluationPrompts.js'
import { buildFastSessionTurnSummaryPrompt } from './evaluationPrompts.js'
import { buildFastSessionFinalAggregationPrompt } from './evaluationPrompts.js'
import { fastSessionFinalAnalysisReportSchema } from './schemas.js'

export class FastSessionAnalysis extends AnalysisSessionBase {
  static readonly workflowKind = ANALYSIS_WORKFLOW_KIND.FAST_SESSION
  static readonly workflowLabel = 'Fast Session Analysis'
  static create(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    input: AnalysisWorkflowInput,
  ): FastSessionAnalysis {
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
      workflow_kind: ANALYSIS_WORKFLOW_KIND.FAST_SESSION,
    }
    return new FastSessionAnalysis(db, lm, mcp, input, state)
  }

  static rehydrate(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    sessionId: string,
  ): FastSessionAnalysis | null {
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
    return new FastSessionAnalysis(db, lm, mcp, input, state)
  }

  protected getWorkflowKind(): string {
    return ANALYSIS_WORKFLOW_KIND.FAST_SESSION
  }

  static buildSystemPrompt(input: { analysisGoal: string; selectedToolNames: string[]; onlyFailedToolCalls: boolean; evaluationCriteria: string[] }): string {
    return buildFastSessionSystemPrompt(input)
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────

  protected async beforeSession(): Promise<void> {
    if (this.state.bootstrapComplete) return

    this.emit({ type: 'analysis-phase-changed', phase: 'bootstrap' })

    await new BootstrapStep(this.db, this.lm, this.mcp, {
      indexSchemaKey: SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
    })
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
      artifactSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
      buildPrompt: buildFastSessionToolCallAssessmentPrompt,
      computeNextPhase: ({ nextPacketIndex, packetCount }) =>
        nextPacketIndex < packetCount ? 'assessing' : 'turn_summary',
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
      assessmentSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
      summarySchemaKey: SELF_KEY.TURN_SUMMARY,
      buildPrompt: (params) => buildFastSessionTurnSummaryPrompt({
        analysisTarget: params.analysisTarget as AnalysisTarget,
        subjectId: params.subjectId as string,
        currentTurnId: params.currentTurnId as string,
        turnPacketCount: params.turnPacketCount as number,
        repeatedTools: Array.isArray(params.repeatedTools)
          ? (params.repeatedTools as string[]).join(', ') : (params.repeatedTools as string),
      }),
    }).execute(this.buildStepContext(STEP_TYPE.ANALYSIS_TURN_SUMMARY))

    this.emit({ type: 'analysis-phase-changed', phase: this.state.phase })
  }

  protected async afterSession(): Promise<void> {
    if (this.state.finalAggregationComplete) return

    if (!this.state.coverageValidated) {
      const validated = runCoverageValidationStep(this.db, {
        state: this.state,
        stepId: this.state.analysisSessionId,
        assessmentSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
      })
      this.state = { ...this.state, ...validated.updatedState }
    }

    this.emit({ type: 'analysis-phase-changed', phase: 'final_aggregation' })

    await new FinalAggregationStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
      summarySchemaKey: SELF_KEY.TURN_SUMMARY,
      reportSchemaKey: SELF_KEY.FINAL_ANALYSIS_REPORT,
      buildPrompt: (params) => buildFastSessionFinalAggregationPrompt({
        analysisTarget: params.analysisTarget as AnalysisTarget,
        assessmentCount: params.assessmentCount as number,
        turnSummaryCount: params.turnSummaryCount as number,
      }),
      reportSchema: fastSessionFinalAnalysisReportSchema,
    }).execute(this.buildStepContext(STEP_TYPE.ANALYSIS_FINAL_AGGREGATION))

    this.emit({ type: 'analysis-phase-changed', phase: this.state.phase })
  }
}
