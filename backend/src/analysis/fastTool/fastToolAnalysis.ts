/**
 * Fast-tool analysis — subclass of AnalysisSessionBase.
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
  type FastToolWorkIndex,
} from '../schemas.js'
import { ANALYSIS_WORKFLOW_KIND } from '../workflowKinds.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { BootstrapStep } from '../shared/bootstrapStep.js'
import { FinalAggregationStep } from '../shared/finalAggregationStep.js'
import { FastToolGroupedAssessmentStep } from './fastToolGroupedAssessmentStep.js'
import { buildFastToolWorkIndex } from './fastToolPlanning.js'
import { buildFastToolFinalAggregationPrompt } from './evaluationPrompts.js'
import { fastToolFinalReportSchema } from '../schemas.js'

export class FastToolAnalysis extends AnalysisSessionBase {
  static readonly workflowKind = ANALYSIS_WORKFLOW_KIND.FAST_TOOL
  static readonly workflowLabel = 'Fast Tool Analysis'
  static create(
    db: BackendDatabase,
    lm: LmStudioGateway,
    mcp: McpGateway,
    input: AnalysisWorkflowInput,
  ): FastToolAnalysis {
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
      workflow_kind: ANALYSIS_WORKFLOW_KIND.FAST_TOOL,
    }
    return new FastToolAnalysis(db, lm, mcp, input, state)
  }

  static rehydrate(
    db: BackendDatabase,
    lm: LmStudioGateway,
    mcp: McpGateway,
    sessionId: string,
  ): FastToolAnalysis | null {
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
    return new FastToolAnalysis(db, lm, mcp, input, state)
  }

  protected getWorkflowKind(): string {
    return ANALYSIS_WORKFLOW_KIND.FAST_TOOL
  }

  buildSystemPrompt(): string {
    return ''
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────

  protected async beforeSession(): Promise<void> {
    if (this.state.bootstrapComplete) return

    this.emit({ type: 'analysis-phase-changed', phase: 'bootstrap' })

    await new BootstrapStep(this.db, this.lm, this.mcp, {
      indexSchemaKey: SCHEMA_KEY.FAST_TOOL_WORK_INDEX,
      buildIndexContent: buildFastToolWorkIndex,
    })
      .execute(this.buildStepContext(STEP_TYPE.ANALYSIS_BOOTSTRAP))

    this.emit({ type: 'analysis-phase-changed', phase: this.state.phase })
  }

  protected async onToolCall(part: PartInfo, _round: RoundInfo, _turn: TurnInfo): Promise<void> {
    const workIndexArtifact = this.readArtifact(SCHEMA_KEY.FAST_TOOL_WORK_INDEX)
    const targetArtifact = this.readArtifact(SCHEMA_KEY.ANALYSIS_TARGET)
    if (!workIndexArtifact || !targetArtifact) return

    const workIndex = workIndexArtifact.content as FastToolWorkIndex
    const workUnit = workIndex.tool_groups[this.state.nextPacketIndex]
    if (!workUnit || !workUnit.tool_call_part_ids.includes(part.id)) return

    await new FastToolGroupedAssessmentStep(this.db, this.lm, this.mcp, {
      workUnit,
      analysisTarget: targetArtifact.content as AnalysisTarget,
      analysisSessionState: this.state as unknown as Record<string, unknown>,
    }).execute(this.buildStepContext(STEP_TYPE.ANALYSIS_TOOL_GROUP_ASSESSMENT))
  }

  protected async afterSession(): Promise<void> {
    if (this.state.finalAggregationComplete) return

    this.emit({ type: 'analysis-phase-changed', phase: 'final_aggregation' })

    await new FinalAggregationStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SCHEMA_KEY.FAST_TOOL_GROUP_ASSESSMENT,
      summarySchemaKey: SCHEMA_KEY.FAST_TOOL_GROUP_ASSESSMENT,
      reportSchemaKey: SCHEMA_KEY.FAST_TOOL_FINAL_REPORT,
      buildPrompt: (params) => buildFastToolFinalAggregationPrompt({
        analysisTarget: params.analysisTarget as AnalysisTarget,
        assessmentCount: params.assessmentCount as number,
      } as any),
      reportSchema: fastToolFinalReportSchema,
      buildDeterministicReport: (_sid, assessments) => {
        if (assessments.length !== 1) return null
        const a = assessments[0]
        if (!a || a.verdict === 'fail' || a.score <= 2) return null
        return {
          overall_tool_use_outcome: a.verdict === 'pass' ? 'strong' : a.verdict === 'partial' ? 'mixed' : 'unclear',
          overall_rationale: a.reasoning,
          tool_summaries: [] as unknown[],
          repeated_failure_patterns: [] as unknown[],
          follow_up_candidates: [] as unknown[],
          total_tool_groups_assessed: 1,
          total_tool_calls_assessed: assessments.length,
        }
      },
    }).execute(this.buildStepContext(STEP_TYPE.ANALYSIS_FINAL_AGGREGATION))

    this.emit({ type: 'analysis-phase-changed', phase: this.state.phase })
  }
}
