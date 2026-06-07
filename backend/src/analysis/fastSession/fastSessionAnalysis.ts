/**
 * Fast-session analysis — subclass of AnalysisSessionBase.
 *
 * buildPlan() produces a list of AnalysisCommands by reading the evidence
 * packet index artifact left by bootstrap, creating one AssessCommand per
 * packet and one TurnSummaryCommand per turn.
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
  type AnalysisTarget,
  type EvidencePacketIndex,
  type EvidencePacket,
} from '../schemas.js'
import { SCHEMA_KEY as SELF_KEY, fastSessionFinalAnalysisReportSchema } from './schemas.js'
import { ANALYSIS_WORKFLOW_KIND } from '../workflowKinds.js'
import { BootstrapStep } from '../shared/bootstrapStep.js'
import { ToolCallAssessmentStep } from '../shared/toolCallAssessmentStep.js'
import { TurnSummaryStep } from '../shared/turnSummaryStep.js'
import { FinalAggregationStep } from '../shared/finalAggregationStep.js'
import { CoverageValidationStep } from '../coverageValidationStep.js'
import { buildFastSessionToolCallAssessmentPrompt } from './evaluationPrompts.js'
import { buildFastSessionTurnSummaryPrompt } from './evaluationPrompts.js'
import { buildFastSessionFinalAggregationPrompt } from './evaluationPrompts.js'
import { buildFastSessionSystemPrompt } from './systemPrompt.js'

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
      analysisSessionId: input.analysisSessionId,
      targetSessionId: input.targetSessionId,
      targetTurnId: input.targetTurnId,
      analysisGoal: input.analysisGoal,
      selectedToolNames: input.selectedToolNames,
      onlyFailedToolCalls: input.onlyFailedToolCalls,
      evaluationCriteria: input.evaluationCriteria,
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

  // ── Hooks — called by buildPlan() during tree traversal ───────────────────

  protected onBeforeSession(): void {
    this.addCommand(new BootstrapStep(this.db, this.lm, this.mcp, {
      indexSchemaKey: SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
    }))
  }

  protected onToolCall(part: PartInfo, _round: RoundInfo, _turn: TurnInfo): void {
    const targetArtifact = this.readArtifact(SCHEMA_KEY.ANALYSIS_TARGET)
    const indexArtifact = this.readArtifact(SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
    if (!targetArtifact || !indexArtifact) return

    const knownPackets = (indexArtifact.content as EvidencePacketIndex).packets
    let packet: EvidencePacket | undefined = knownPackets.find(p => p.tool_call_part_id === part.id)
    if (!packet) {
      const knownIds = new Set(knownPackets.map(p => p.tool_call_part_id))
      packet = this.discoverNewPackets(knownIds).find(p => p.tool_call_part_id === part.id)
    }
    if (packet) {
      const analysisTarget = targetArtifact.content as AnalysisTarget
      this.addCommand(new ToolCallAssessmentStep(this.db, this.lm, this.mcp, {
        artifactSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
        buildPrompt: buildFastSessionToolCallAssessmentPrompt,
        packet,
        analysisTarget,
      }))
    }
  }

  protected onAfterTurn(turn: TurnInfo): void {
    const hasToolCalls = turn.rounds.some(r => r.parts.some(p => p.type === 'tool_call'))
    if (hasToolCalls) {
      this.addCommand(new TurnSummaryStep(this.db, this.lm, this.mcp, {
        assessmentSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
        summarySchemaKey: SELF_KEY.TURN_SUMMARY,
        turnId: turn.id,
        buildPrompt: (params) => buildFastSessionTurnSummaryPrompt({
          analysisTarget: params.analysisTarget as AnalysisTarget,
          subjectId: params.subjectId as string,
          turnPacketCount: params.turnPacketCount as number,
          repeatedTools: params.repeatedTools as string,
        }),
      }))
    }
  }

  protected onAfterSession(): void {
    this.addCommand(new CoverageValidationStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
    }))
    this.addCommand(new FinalAggregationStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SELF_KEY.TOOL_CALL_ASSESSMENT,
      summarySchemaKey: SELF_KEY.TURN_SUMMARY,
      reportSchemaKey: SELF_KEY.FINAL_ANALYSIS_REPORT,
      buildPrompt: (params) => buildFastSessionFinalAggregationPrompt({
        analysisTarget: params.analysisTarget as AnalysisTarget,
        assessmentCount: params.assessmentCount as number,
        turnSummaryCount: params.turnSummaryCount as number,
      }),
      reportSchema: fastSessionFinalAnalysisReportSchema,
    }))
  }
}
