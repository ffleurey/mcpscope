import crypto from 'node:crypto'
import type { BackendDatabase } from '../../persistence/db.js'
import type { ChatCompletionGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import { WorkflowStep } from '../../workflow/workflowStep.js'
import type { StepContext } from '../../workflow/stepContext.js'
import type { StepResult, StepTypeKey } from '../../domain/executionModel.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { getSessionRecord, getPartRecord, updatePartRecord, listPartRecordsBySession } from '../../persistence/repository.js'
import { insertJsonArtifact, getLatestArtifactBySchemaKey } from '../artifactRepository.js'
import { runDeterministicMcpToolCallsInSingleTurn } from '../../runtime/toolTurns.js'
import { runAnalysisTurn } from '../boundedTurn.js'
import {
  SCHEMA_KEY,
  evaluationResultSchema,
  type AnalysisTarget,
} from '../schemas.js'
import type { FastToolWorkGroup } from './schemas.js'
import type { ZodError } from 'zod'
import { buildFastToolGroupedAssessmentPrompt } from './evaluationPrompts.js'

function uuid(): string { return crypto.randomUUID() }
function now(): number { return Date.now() }

export interface FastToolGroupedAssessmentStepConfig {
  artifactSchemaKey: string
  workUnit: FastToolWorkGroup
  analysisTarget: AnalysisTarget
}

export class FastToolGroupedAssessmentStep extends WorkflowStep {
  readonly stepLabel = 'Grouped Assessment'
  readonly kind = 'assess'
  readonly stepTypeKey: StepTypeKey = STEP_TYPE.ANALYSIS_TOOL_GROUP_ASSESSMENT
  get semanticId(): string { return '' }

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    return getLatestArtifactBySchemaKey(db.connection, sessionId, this.config.artifactSchemaKey) !== null
  }

  constructor(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    private readonly config: FastToolGroupedAssessmentStepConfig,
  ) {
    super(db, lm, mcp)
  }

  protected async run(ctx: StepContext): Promise<StepResult> {
    const analysisSessionId = ctx.sessionId
    const { workUnit, analysisTarget } = this.config

    const analysisSession = getSessionRecord(this.db.connection, analysisSessionId)
    if (!analysisSession) throw new Error(`Grouped assessment: session not found: ${analysisSessionId}`)

    const injectPartIds: string[] = []
    const rawEvidenceIds = [
      ...workUnit.reasoning_before_part_ids,
      ...workUnit.tool_call_part_ids,
      ...workUnit.tool_result_part_ids,
      ...workUnit.reasoning_after_part_ids,
    ]
    const evidenceQueries = rawEvidenceIds
      .filter((id, idx, arr) => id !== null && arr.indexOf(id) === idx)
      .map(id => ({ toolName: 'mcpscope_inspect', toolArgs: { id } }))

    if (evidenceQueries.length > 0) {
      const { toolCallPartIds, toolResultPartIds } = await runDeterministicMcpToolCallsInSingleTurn(
        this.db, this.mcp, analysisSession, evidenceQueries,
        ctx.emitSink, this.stepId,
      )
      injectPartIds.push(...toolCallPartIds, ...toolResultPartIds)
    }

    const question = buildFastToolGroupedAssessmentPrompt({
      analysisTarget,
      subjectId: workUnit.work_unit_id,
      workUnitId: workUnit.work_unit_id,
      toolName: workUnit.tool_name,
      toolCallPartIds: workUnit.tool_call_part_ids,
      turnIds: workUnit.turn_ids,
      totalToolCalls: workUnit.tool_call_part_ids.length,
    })

    const turnResult = await runAnalysisTurn(this.db, this.lm, this.mcp, analysisSessionId, question, ctx.emitSink, this.stepId)

    const ts = now()
    let parsedJson: unknown
    try { parsedJson = JSON.parse(extractJsonBlock(turnResult.responseText)) } catch (e) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'fast_tool_grouped_assessment', error_kind: 'json_parse_error', message: 'Not valid JSON', detail: { raw_response: turnResult.responseText, error: String(e) } },
        metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC, work_unit_id: workUnit.work_unit_id }, createdAt: ts,
      })
      return { status: 'error', outputArtifacts: [] }
    }

    const parsed = evaluationResultSchema.safeParse(parsedJson)
    if (!parsed.success) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'fast_tool_grouped_assessment', error_kind: 'schema_validation_error', message: 'Schema mismatch', detail: { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues } },
        metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC, work_unit_id: workUnit.work_unit_id }, createdAt: ts,
      })
      return { status: 'error', outputArtifacts: [] }
    }

    insertJsonArtifact(this.db.connection, {
      id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
      content: parsed.data,
      metadata: {
        schema_key: this.config.artifactSchemaKey,
        work_unit_id: workUnit.work_unit_id,
        tool_name: workUnit.tool_name,
        subject_scope: parsed.data.subject_scope,
        subject_id: parsed.data.subject_id,
      },
      createdAt: ts,
    })

    this.mutateContextAfterGroupedAssessment(
      analysisSessionId, injectPartIds,
      turnResult.assistantReasoningPartIds, turnResult.turnId,
    )
    return { status: 'complete', outputArtifacts: [] }
  }

  private mutateContextAfterGroupedAssessment(
    analysisSessionId: string, injectPartIds: string[],
    reasoningPartIds: string[], userTurnId: string | null,
  ): void {
    const mutatedAt = Date.now()
    const conn = this.db.connection
    for (const partId of injectPartIds) {
      const part = getPartRecord(conn, partId)
      if (part) updatePartRecord(conn, { ...part, context: { ...part.context, state: 'excluded', note: 'Deterministic grouped evidence excluded after grouped assessment completed' }, updatedAt: mutatedAt })
    }
    for (const partId of reasoningPartIds) {
      const part = getPartRecord(conn, partId)
      if (part) updatePartRecord(conn, { ...part, context: { ...part.context, state: 'excluded', note: 'Grouped assessment reasoning excluded after grouped assessment completed' }, updatedAt: mutatedAt })
    }
    if (userTurnId) {
      const userPart = listPartRecordsBySession(conn, analysisSessionId)
        .find(p => p.turnId === userTurnId && p.partType === 'user-message')
      if (userPart) updatePartRecord(conn, { ...userPart, context: { ...userPart.context, state: 'historical-only', note: 'Grouped assessment question excluded' }, updatedAt: mutatedAt })
    }
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
