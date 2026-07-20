import crypto from 'node:crypto'
import type { BackendDatabase } from 'mcpscope-engine/persistence/db.js'
import type { ChatCompletionGateway } from 'mcpscope-engine/runtime/modelTurns.js'
import type { McpGateway } from 'mcpscope-engine/runtime/toolTurns.js'
import { WorkflowStep } from '../../workflow/workflowStep.js'
import type { StepContext } from '../../workflow/stepContext.js'
import type { StepResult, StepTypeKey } from 'mcpscope-engine/domain/executionModel.js'
import { STEP_TYPE } from 'mcpscope-engine/domain/executionModel.js'
import {
  listPartRecordsBySession,
  listRoundRecordsBySession,
} from 'mcpscope-engine/persistence/repository.js'
import { insertJsonArtifact, getLatestArtifactBySchemaKey } from '../artifactRepository.js'
import { runAnalysisTurn, turnCalledInspect, turnHasFinalAnswer } from '../boundedTurn.js'
import { extractJsonBlock } from '../shared/extractJson.js'
import { SCHEMA_KEY as CORE_KEY, type AnalysisSessionState, type AnalysisTarget } from '../schemas.js'
import type { RubricCriterion } from 'mcpscope-engine/domain/model.js'
import { SCHEMA_KEY, benchmarkVerdictSchema, clampVerdictToRubric } from './schemas.js'
import { buildRubricJudgePrompt } from './evaluationPrompts.js'
import type { ZodError } from 'zod'

function uuid(): string { return crypto.randomUUID() }
function now(): number { return Date.now() }

/** Single-step rubric judge: pull-only (bootstrap does NOT inject the trace —
 *  the tool-enabled turn inspects the target session itself) → structured
 *  verdict artifact. */
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

    // Ground truth: did the in-scope turn actually produce a final answer? The
    // backend can verify this from the target's recorded parts, so the "does an
    // answer exist" question is never delegated to the judge's discretion — a
    // flaky judge that skips inspection and fabricates "no final answer" (observed
    // with Gemini scoring 0 in one round with zero tool calls, for a session that
    // DID answer) can no longer decide it. When the answer is genuinely absent,
    // score 0 for every criterion authoritatively, without invoking the judge.
    const targetParts = listPartRecordsBySession(this.db.connection, analysisTarget.target_session_id)
    const targetRounds = listRoundRecordsBySession(
      this.db.connection,
      analysisTarget.target_session_id,
    )
    const targetAnswered = turnHasFinalAnswer(targetParts, targetRounds, analysisTarget.target_turn_id)
    if (!targetAnswered) {
      const verdict = clampVerdictToRubric(rubric, {
        criteria: rubric.map((c) => ({
          id: c.id,
          points: 0,
          note: `Backend-verified: in-scope turn ${analysisTarget.target_turn_id} produced no final answer; scored 0.`,
        })),
        comment: `In-scope turn ${analysisTarget.target_turn_id} produced no final answer (backend-verified).`,
      })
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

    const question = buildRubricJudgePrompt({ analysisTarget, rubric })
    const turnResult = await runAnalysisTurn(this.db, this.lm, this.mcp, analysisSessionId, question, ctx.emitSink, this.stepId)

    // The target DID answer, so a verdict is only trustworthy if the judge
    // actually inspected it (the trace is pull-only — nothing is injected). A
    // verdict produced without a single mcpscope_inspect call was fabricated;
    // surface it as a retryable error rather than recording bogus scores.
    const judgeParts = listPartRecordsBySession(this.db.connection, analysisSessionId)
    const judgeRounds = listRoundRecordsBySession(this.db.connection, analysisSessionId)
    if (!turnCalledInspect(judgeParts, judgeRounds, turnResult.turnId)) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'benchmark_evaluation', error_kind: 'no_inspection', message: `Judge produced a verdict without inspecting the target session (${analysisTarget.target_session_id} did produce a final answer). The verdict is not grounded in the trace — retry the evaluation.` },
        metadata: { schema_key: CORE_KEY.DIAGNOSTIC }, createdAt: ts,
      })
      return { status: 'error', outputArtifacts: [] }
    }

    // No final answer at all → the judge never emitted a verdict. The usual
    // cause is exhausting the tool-call budget without answering (often because
    // the judge's context window is too small to hold the trace it is
    // inspecting), NOT malformed JSON — classify it as such so the error points
    // at the real fix.
    if (turnResult.responseText.trim().length === 0) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'benchmark_evaluation', error_kind: 'no_verdict', message: 'Judge produced no verdict (it may have exhausted its tool-call budget without answering — commonly a context window too small for the trace being judged)' },
        metadata: { schema_key: CORE_KEY.DIAGNOSTIC }, createdAt: ts,
      })
      return { status: 'error', outputArtifacts: [] }
    }

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
