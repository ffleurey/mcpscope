import crypto from 'node:crypto'
import type { BackendDatabase } from '../../persistence/db.js'
import type { ChatCompletionGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import { WorkflowStep } from '../../workflow/workflowStep.js'
import type { StepContext } from '../../workflow/stepContext.js'
import type { StepResult, StepTypeKey } from '../../domain/executionModel.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { getSessionRecord, getPartRecord, updatePartRecord } from '../../persistence/repository.js'
import { insertJsonArtifact, getLatestArtifactBySchemaKey, listArtifactsBySessionAndSchemaKey } from '../artifactRepository.js'
import { runAnalysisTurn } from '../boundedTurn.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvaluationResult,
} from '../schemas.js'
import type { ZodError, ZodTypeAny } from 'zod'

function uuid(): string { return crypto.randomUUID() }
function now(): number { return Date.now() }

export interface FinalAggregationStepConfig {
  assessmentSchemaKey: string
  summarySchemaKey: string
  reportSchemaKey: string
  buildPrompt: (params: Record<string, unknown>) => string
  reportSchema: ZodTypeAny
  /** Optional: if provided and returns non-null, the step short-circuits without an LLM call. */
  buildDeterministicReport?: (
    analysisSessionId: string,
    assessments: EvaluationResult[],
    summaries: EvaluationResult[],
    assessmentCount: number,
  ) => Record<string, unknown> | null
}

export class FinalAggregationStep extends WorkflowStep {
  readonly stepLabel = 'Final Aggregation'
  readonly kind = 'final_aggregation'
  readonly stepTypeKey: StepTypeKey = STEP_TYPE.ANALYSIS_FINAL_AGGREGATION
  get semanticId(): string { return '' }

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, this.config.reportSchemaKey) !== null
  }

  constructor(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    private readonly config: FinalAggregationStepConfig,
  ) {
    super(db, lm, mcp)
  }

  protected async run(ctx: StepContext): Promise<StepResult> {
    const state = ctx.workflowState as unknown as AnalysisSessionState | undefined
    if (!state) throw new Error('FinalAggregationStep: workflowState required')
    const { analysisSessionId } = state

    const analysisSession = getSessionRecord(this.db.connection, analysisSessionId)
    if (!analysisSession) throw new Error(`Final aggregation: session not found: ${analysisSessionId}`)

    const targetArtifact = getLatestArtifactBySchemaKey(this.db.connection, analysisSessionId, SCHEMA_KEY.ANALYSIS_TARGET)
    if (!targetArtifact) throw new Error('Final aggregation: analysis_target missing')
    const analysisTarget = targetArtifact.content as AnalysisTarget

    const { assessmentSchemaKey, summarySchemaKey, reportSchemaKey, buildPrompt, reportSchema, buildDeterministicReport } = this.config

    const assessments = listArtifactsBySessionAndSchemaKey(this.db.connection, analysisSessionId, assessmentSchemaKey)
    const summaries = listArtifactsBySessionAndSchemaKey(this.db.connection, analysisSessionId, summarySchemaKey)
    const typedAssessments = assessments.map(a => a.content as EvaluationResult)
    const typedSummaries = summaries.map(a => a.content as EvaluationResult)

    if (buildDeterministicReport) {
      const det = buildDeterministicReport(analysisSessionId, typedAssessments, typedSummaries, assessments.length)
      if (det) {
        insertJsonArtifact(this.db.connection, {
          id: uuid(), sessionId: analysisSessionId, stepId: this.stepId, content: det,
          metadata: { schema_key: reportSchemaKey, total_packets: assessments.length, synthesis_mode: 'deterministic' },
          createdAt: now(),
        })
        return { status: 'complete', outputArtifacts: [] }
      }
    }

    const question = buildPrompt({
      analysisTarget,
      assessmentCount: assessments.length,
      turnSummaryCount: typedSummaries.length,
    })
    const turnResult = await runAnalysisTurn(this.db, this.lm, this.mcp, analysisSessionId, question, ctx.emitSink, this.stepId)

    const ts = now()
    let parsedJson: unknown
    try { parsedJson = JSON.parse(extractJsonBlock(turnResult.responseText)) } catch (e) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'final_aggregation', error_kind: 'json_parse_error', message: 'Not valid JSON', detail: { raw_response: turnResult.responseText, error: String(e) } },
        metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC }, createdAt: ts,
      })
      return { status: 'error', outputArtifacts: [] }
    }

    const parsed = reportSchema.safeParse(parsedJson)
    if (!parsed.success) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'final_aggregation', error_kind: 'schema_validation_error', message: 'Schema mismatch', detail: { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues } },
        metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC }, createdAt: ts,
      })
      return { status: 'error', outputArtifacts: [] }
    }

    insertJsonArtifact(this.db.connection, {
      id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
      content: { ...(parsed.data as Record<string, unknown>), total_tool_calls_assessed: (parsed.data as Record<string, unknown>).total_tool_calls_assessed ?? assessments.length },
      metadata: { schema_key: reportSchemaKey, target_session_id: state.targetSessionId, target_turn_id: state.targetTurnId, total_packets: assessments.length },
      createdAt: ts,
    })

    retireFinalPromptContext(this.db, turnResult.userPartId, turnResult.assistantReasoningPartIds)

    return { status: 'complete', outputArtifacts: [] }
  }
}

function retireFinalPromptContext(database: BackendDatabase, userPartId: string, reasoningPartIds: string[]): void {
  const ts = now()
  if (userPartId) {
    const up = getPartRecord(database.connection, userPartId)
    if (up) updatePartRecord(database.connection, { ...up, context: { ...up.context, state: 'historical-only', note: 'Final aggregation question excluded' }, updatedAt: ts })
  }
  for (const id of reasoningPartIds) {
    const rp = getPartRecord(database.connection, id)
    if (!rp) continue
    updatePartRecord(database.connection, { ...rp, context: { ...rp.context, state: 'excluded', note: 'Final aggregation reasoning excluded' }, updatedAt: ts })
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
