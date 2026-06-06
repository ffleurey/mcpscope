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
} from '../schemas.js'
import { SCHEMA_KEY as SELF_KEY, finalAnalysisReportSchema } from './schemas.js'
import { ANALYSIS_WORKFLOW_KIND } from '../workflowKinds.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { BootstrapStep } from '../shared/bootstrapStep.js'
import { ToolCallAssessmentStep } from '../shared/toolCallAssessmentStep.js'
import { TurnSummaryStep } from '../shared/turnSummaryStep.js'
import { FinalAggregationStep } from '../shared/finalAggregationStep.js'
import { runCoverageValidationStep } from '../coverageValidationStep.js'
import { buildToolCallEvaluationPrompt } from './evaluationPrompts.js'
import { buildTurnSummaryEvaluationPrompt } from './evaluationPrompts.js'
import { buildFinalAggregationEvaluationPrompt } from './evaluationPrompts.js'
import { getLatestArtifactBySchemaKey } from '../artifactRepository.js'
import { buildFullSessionSystemPrompt } from './systemPrompt.js'

export class FullSessionAnalysis extends AnalysisSessionBase {
  static readonly workflowKind = ANALYSIS_WORKFLOW_KIND.FULL_SESSION
  static readonly workflowLabel = 'Full Analysis'
  static create(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
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
    lm: ChatCompletionGateway,
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

  static buildSystemPrompt(input: { analysisGoal: string; selectedToolNames: string[]; onlyFailedToolCalls: boolean; evaluationCriteria: string[] }): string {
    return buildFullSessionSystemPrompt(input)
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
      buildPrompt: buildToolCallEvaluationPrompt,
      computeNextPhase: ({ analysisSessionId, currentTurnId, nextPacketIndex }) => {
        const artifact = getLatestArtifactBySchemaKey(this.db.connection, analysisSessionId, SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
        const idx = artifact?.content as EvidencePacketIndex | undefined
        const next = idx?.packets[nextPacketIndex]
        return !next || next.turn_id !== currentTurnId ? 'turn_summary' : 'assessing'
      },
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
      buildPrompt: (params) => buildTurnSummaryEvaluationPrompt({
        analysisTarget: params.analysisTarget as AnalysisTarget,
        subjectId: params.subjectId as string,
        repeatedTools: params.repeatedTools as string[],
        repeatedAttemptGuidance: params.repeatedAttemptGuidance as string | null,
        turnPacketCount: params.turnPacketCount as number,
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
      buildPrompt: (params) => buildFinalAggregationEvaluationPrompt({
        analysisTarget: params.analysisTarget as AnalysisTarget,
        assessmentCount: params.assessmentCount as number,
        turnSummaryCount: params.turnSummaryCount as number,
      }),
      reportSchema: finalAnalysisReportSchema,
      buildDeterministicReport: (_sid, assessments, turnSummaries) => {
        if (turnSummaries.length !== 1 || assessments.length === 0) return null
        const s = turnSummaries[0]
        if (!s || assessments.find(a => a.verdict === 'fail' || a.score <= 2)) return null
        const outcome = s.verdict === 'pass' ? 'answered' : s.verdict === 'partial' ? 'partial' : s.verdict === 'fail' ? 'blocked' : 'unclear'
        const first = (t: string) => { const m = t.trim().match(/^.*?[.!?](?:\s|$)/); return m?.[0]?.trim() ?? t.trim() }
        return {
          outcome, outcome_rationale: first(s.reasoning),
          primary_issue: null, primary_issue_rationale: null,
          path_efficiency: 'efficient', path_efficiency_rationale: first(s.reasoning),
          findings: [s.reasoning], tool_description_findings: [],
          improvement_suggestions: [], tool_description_improvement_suggestions: [],
          total_tool_calls_assessed: assessments.length,
        }
      },
    }).execute(this.buildStepContext(STEP_TYPE.ANALYSIS_FINAL_AGGREGATION))

    this.emit({ type: 'analysis-phase-changed', phase: this.state.phase })
  }
}
