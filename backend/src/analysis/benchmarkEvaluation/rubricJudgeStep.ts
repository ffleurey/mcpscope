import crypto from 'node:crypto'
import type { BackendDatabase } from '../../persistence/db.js'
import type { ChatCompletionGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import { WorkflowStep } from '../../workflow/workflowStep.js'
import type { StepContext } from '../../workflow/stepContext.js'
import type { StepResult, StepTypeKey } from '../../domain/executionModel.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { insertJsonArtifact, getLatestArtifactBySchemaKey } from '../artifactRepository.js'
import { runAnalysisTurn } from '../boundedTurn.js'
import { SCHEMA_KEY as CORE_KEY, type AnalysisSessionState, type AnalysisTarget } from '../schemas.js'
import type { RubricCriterion } from '../../domain/model.js'
import { SCHEMA_KEY, benchmarkVerdictSchema, clampVerdictToRubric } from './schemas.js'
import { buildRubricJudgePrompt } from './evaluationPrompts.js'
import type { ZodError } from 'zod'

function uuid(): string { return crypto.randomUUID() }
function now(): number { return Date.now() }

/** Single-step rubric judge: push (bootstrap already loaded the trace) + pull
 *  (the turn is tool-enabled) → structured verdict artifact. */
export class RubricJudgeStep extends WorkflowStep {
  readonly stepLabel = 'Rubric Judge'
  readonly kind = 'assess'
  readonly stepTypeKey: StepTypeKey = STEP_TYPE.ANALYSIS_BENCHMARK_EVALUATION
  get semanticId(): string { return '' }

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, SCHEMA_KEY.VERDICT) !== null
  }

  constructor(db: BackendDatabase, lm: ChatCompletionGateway, mcp: McpGateway) {
    super(db, lm, mcp)
  }

  protected async run(ctx: StepContext): Promise<StepResult> {
    const analysisSessionId = ctx.sessionId
    const state = ctx.workflowState as unknown as AnalysisSessionState | undefined
    const rubric: RubricCriterion[] = state?.rubric ?? []
    const ts = now()

    if (rubric.length === 0) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'benchmark_evaluation', error_kind: 'no_rubric', message: 'No rubric criteria to score' },
        metadata: { schema_key: CORE_KEY.DIAGNOSTIC }, createdAt: ts,
      })
      return { status: 'error', outputArtifacts: [] }
    }

    const targetArtifact = getLatestArtifactBySchemaKey(this.db.connection, analysisSessionId, CORE_KEY.ANALYSIS_TARGET)
    if (!targetArtifact) throw new Error('RubricJudgeStep: analysis target artifact missing')
    const analysisTarget = targetArtifact.content as AnalysisTarget

    const question = buildRubricJudgePrompt({ analysisTarget, rubric })
    const turnResult = await runAnalysisTurn(this.db, this.lm, this.mcp, analysisSessionId, question, ctx.emitSink, this.stepId)

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(extractJsonBlock(turnResult.responseText))
    } catch (e) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'benchmark_evaluation', error_kind: 'json_parse_error', message: 'Judge response was not valid JSON', detail: { raw_response: turnResult.responseText, error: String(e) } },
        metadata: { schema_key: CORE_KEY.DIAGNOSTIC }, createdAt: ts,
      })
      return { status: 'error', outputArtifacts: [] }
    }

    const parsed = benchmarkVerdictSchema.safeParse(parsedJson)
    if (!parsed.success) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'benchmark_evaluation', error_kind: 'schema_validation_error', message: 'Judge verdict did not match schema', detail: { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues } },
        metadata: { schema_key: CORE_KEY.DIAGNOSTIC }, createdAt: ts,
      })
      return { status: 'error', outputArtifacts: [] }
    }

    // Reconcile against the rubric: one clamped entry per criterion, so the
    // stored verdict is trustworthy regardless of what the judge returned.
    const verdict = clampVerdictToRubric(rubric, parsed.data)
    const awarded = verdict.criteria.reduce((sum, c) => sum + c.points, 0)
    const max = rubric.reduce((sum, c) => sum + c.points, 0)

    insertJsonArtifact(this.db.connection, {
      id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
      content: verdict,
      metadata: { schema_key: SCHEMA_KEY.VERDICT, awarded_points: awarded, max_points: max },
      createdAt: ts,
    })
    return { status: 'complete', outputArtifacts: [] }
  }
}

function extractJsonBlock(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}
