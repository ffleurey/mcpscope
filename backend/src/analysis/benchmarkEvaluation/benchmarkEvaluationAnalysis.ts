/**
 * Benchmark evaluation analysis — subclass of AnalysisSessionBase.
 *
 * A single-step rubric judge: bootstrap (load + push the target session) →
 * rubric judge (score against the case rubric, emit a verdict artifact). Reuses
 * the analysis framework wholesale; the only new behavior is the rubric judge
 * step. Launched per benchmark run-session with a separate judge model.
 */

import type { BackendDatabase } from '../../persistence/db.js'
import type { ChatCompletionGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import { AnalysisSessionBase } from '../analysisSessionBase.js'
import type { AnalysisWorkflowInput } from '../analysisWorkflowInput.js'
import { SCHEMA_KEY as CORE_KEY } from '../schemas.js'
import { ANALYSIS_WORKFLOW_KIND } from '../workflowKinds.js'
import { BootstrapStep } from '../shared/bootstrapStep.js'
import { SCHEMA_KEY } from './schemas.js'
import { RubricJudgeStep } from './rubricJudgeStep.js'
import { buildBenchmarkEvaluationSystemPrompt } from './systemPrompt.js'

export class BenchmarkEvaluationAnalysis extends AnalysisSessionBase {
  static readonly workflowKind = ANALYSIS_WORKFLOW_KIND.BENCHMARK_EVALUATION
  static readonly workflowLabel = 'Benchmark Evaluation'

  static rehydrate(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    sessionId: string,
  ): BenchmarkEvaluationAnalysis | null {
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
      rubric: state.rubric ?? [],
    }
    return new BenchmarkEvaluationAnalysis(db, lm, mcp, input, state)
  }

  protected getWorkflowKind(): string {
    return ANALYSIS_WORKFLOW_KIND.BENCHMARK_EVALUATION
  }

  static buildSystemPrompt(input: { analysisGoal: string; additionalInstructions?: string }): string {
    return buildBenchmarkEvaluationSystemPrompt(input)
  }

  // ── Hooks — called by buildPlan() during tree traversal ───────────────────

  protected onBeforeSession(): void {
    // Materialize the analysis_target + work-index artifacts, but do NOT inject
    // the target session's trace into context. The judge is tool-enabled and
    // inspects the session itself (named in the judge prompt), starting from the
    // inspect summary and pulling detail only when a criterion needs it.
    this.addCommand(new BootstrapStep(this.db, this.lm, this.mcp, {
      indexSchemaKey: SCHEMA_KEY.WORK_INDEX,
      injectEvidence: false,
    }))
  }

  protected onAfterSession(): void {
    if (!this.readArtifact(CORE_KEY.ANALYSIS_TARGET)) return
    this.addCommand(new RubricJudgeStep(this.db, this.lm, this.mcp))
  }
}
