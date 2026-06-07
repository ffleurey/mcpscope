/**
 * Fast-tool analysis — subclass of AnalysisSessionBase.
 *
 * buildPlan() produces a list of AnalysisCommands: bootstrap → grouped assess
 * → final aggregation.  No per-turn summaries or coverage validation.
 */

import type { BackendDatabase } from '../../persistence/db.js'
import type { ChatCompletionGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import {
  AnalysisSessionBase,
  type AnalysisCommand,
} from '../analysisSessionBase.js'
import type { AnalysisWorkflowInput } from '../analysisWorkflowInput.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type AnalysisTarget,
} from '../schemas.js'
import { SCHEMA_KEY as SELF_KEY, fastToolFinalReportSchema, type FastToolWorkIndex } from './schemas.js'
import { ANALYSIS_WORKFLOW_KIND } from '../workflowKinds.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { BootstrapStep } from '../shared/bootstrapStep.js'
import { FastToolGroupedAssessmentStep } from './fastToolGroupedAssessmentStep.js'
import { FinalAggregationStep } from '../shared/finalAggregationStep.js'
import { buildFastToolWorkIndex } from './fastToolPlanning.js'
import { buildFastToolFinalAggregationPrompt } from './evaluationPrompts.js'
import { getLatestArtifactBySchemaKey } from '../artifactRepository.js'
import { buildFastToolSystemPrompt } from './systemPrompt.js'

export class FastToolAnalysis extends AnalysisSessionBase {
  static readonly workflowKind = ANALYSIS_WORKFLOW_KIND.FAST_TOOL
  static readonly workflowLabel = 'Fast Tool Analysis'
  static create(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    input: AnalysisWorkflowInput,
  ): FastToolAnalysis {
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
    return new FastToolAnalysis(db, lm, mcp, input, state)
  }

  static rehydrate(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
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

  static buildSystemPrompt(input: { analysisGoal: string; selectedToolNames: string[]; onlyFailedToolCalls: boolean; evaluationCriteria: string[] }): string {
    return buildFastToolSystemPrompt(input)
  }

  // ── Hooks — called by buildPlan() during tree traversal ───────────────────

  protected onBeforeSession(): void {
    this.addCommand(new BootstrapCommand(this.db, this.lm, this.mcp))
  }

  protected onAfterSession(): void {
    const workIndexArtifact = this.readArtifact(SELF_KEY.WORK_INDEX)
    const targetArtifact = this.readArtifact(SCHEMA_KEY.ANALYSIS_TARGET)
    if (!workIndexArtifact || !targetArtifact) return

    const workIndex = workIndexArtifact.content as FastToolWorkIndex
    const analysisTarget = targetArtifact.content as AnalysisTarget

    this.addCommand(new GroupedAssessCommand(this.db, this.lm, this.mcp, workIndex, analysisTarget))
    this.addCommand(new FinalCommand(this.db, this.lm, this.mcp))
  }
}

// ── Command implementations ─────────────────────────────────────────────────

class BootstrapCommand implements AnalysisCommand {
  readonly kind = 'bootstrap'
  readonly semanticId = ''
  readonly stepTypeKey = STEP_TYPE.ANALYSIS_BOOTSTRAP

  constructor(
    private readonly db: BackendDatabase,
    private readonly lm: ChatCompletionGateway,
    private readonly mcp: McpGateway,
  ) {}

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, SELF_KEY.WORK_INDEX) !== null
  }

  buildStep(): BootstrapStep {
    return new BootstrapStep(this.db, this.lm, this.mcp, {
      indexSchemaKey: SELF_KEY.WORK_INDEX,
      buildIndexContent: buildFastToolWorkIndex,
    })
  }
}

class GroupedAssessCommand implements AnalysisCommand {
  readonly kind = 'assess'
  readonly semanticId = ''
  readonly stepTypeKey = STEP_TYPE.ANALYSIS_TOOL_GROUP_ASSESSMENT

  constructor(
    private readonly db: BackendDatabase,
    private readonly lm: ChatCompletionGateway,
    private readonly mcp: McpGateway,
    private readonly workIndex: FastToolWorkIndex,
    private readonly analysisTarget: AnalysisTarget,
  ) {}

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, SELF_KEY.GROUP_ASSESSMENT) !== null
  }

  buildStep(): FastToolGroupedAssessmentStep {
    const workUnit = this.workIndex.tool_groups[0]
    if (!workUnit) throw new Error('GroupedAssessCommand: no work groups in index')
    return new FastToolGroupedAssessmentStep(this.db, this.lm, this.mcp, {
      artifactSchemaKey: SELF_KEY.GROUP_ASSESSMENT,
      workUnit,
      analysisTarget: this.analysisTarget,
    })
  }
}

class FinalCommand implements AnalysisCommand {
  readonly kind = 'final_aggregation'
  readonly semanticId = ''
  readonly stepTypeKey = STEP_TYPE.ANALYSIS_FINAL_AGGREGATION

  constructor(
    private readonly db: BackendDatabase,
    private readonly lm: ChatCompletionGateway,
    private readonly mcp: McpGateway,
  ) {}

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, SELF_KEY.FINAL_REPORT) !== null
  }

  buildStep(): FinalAggregationStep {
    return new FinalAggregationStep(this.db, this.lm, this.mcp, {
      assessmentSchemaKey: SELF_KEY.GROUP_ASSESSMENT,
      summarySchemaKey: SELF_KEY.GROUP_ASSESSMENT,
      reportSchemaKey: SELF_KEY.FINAL_REPORT,
      buildPrompt: (params) => buildFastToolFinalAggregationPrompt({
        analysisTarget: params.analysisTarget as AnalysisTarget,
        assessmentCount: params.assessmentCount as number,
        totalToolCallCount: params.assessmentCount as number,
      }),
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
    })
  }
}
