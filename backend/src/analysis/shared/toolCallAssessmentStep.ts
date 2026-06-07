import crypto from 'node:crypto'
import type { BackendDatabase } from '../../persistence/db.js'
import type { ChatCompletionGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import { WorkflowStep } from '../../workflow/workflowStep.js'
import type { StepContext } from '../../workflow/stepContext.js'
import type { StepResult, StepTypeKey } from '../../domain/executionModel.js'
import { STEP_TYPE } from '../../domain/executionModel.js'
import { getSessionRecord, getPartRecord, updatePartRecord, listPartRecordsBySession } from '../../persistence/repository.js'
import { insertJsonArtifact, listArtifactsBySessionAndSchemaKey } from '../artifactRepository.js'
import { runDeterministicMcpToolCallsInSingleTurn } from '../../runtime/toolTurns.js'
import { runAnalysisTurn } from '../boundedTurn.js'
import {
  SCHEMA_KEY,
  evaluationResultSchema,
  type AnalysisSessionState,
  type EvidencePacket,
  type AnalysisTarget,
  type EvaluationResult,
} from '../schemas.js'
import type { ZodError } from 'zod'

function uuid(): string { return crypto.randomUUID() }
function now(): number { return Date.now() }

export interface ToolCallAssessmentStepConfig {
  artifactSchemaKey: string
  buildPrompt: (params: {
    analysisTarget: AnalysisTarget
    subjectId: string
    turnId: string
    roundId: string
    toolCallPartId: string
    toolName: string
    toolCallParameters: string
    preReasoningPartId: string | null
    postReasoningPartId: string | null
  }) => string
  packet: EvidencePacket
  analysisTarget: AnalysisTarget
}

export class ToolCallAssessmentStep extends WorkflowStep {
  readonly stepLabel = 'Tool Call Assessment'
  readonly kind = 'assess'
  readonly stepTypeKey: StepTypeKey = STEP_TYPE.ANALYSIS_TOOL_CALL_ASSESSMENT
  get semanticId(): string { return this.config.packet?.tool_call_part_id ?? '' }

  isComplete(db: BackendDatabase, sessionId: string): boolean {
    if (!this.config.packet?.tool_call_part_id) return false
    return listArtifactsBySessionAndSchemaKey(db.connection, sessionId, this.config.artifactSchemaKey)
      .some(a => (a.metadata.tool_call_part_id as string | undefined) === this.config.packet.tool_call_part_id)
  }

  constructor(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
    private readonly config: ToolCallAssessmentStepConfig,
  ) {
    super(db, lm, mcp)
  }

  protected async run(ctx: StepContext): Promise<StepResult> {
    const state = ctx.workflowState as unknown as AnalysisSessionState | undefined
    if (!state) throw new Error('ToolCallAssessmentStep: workflowState required')

    const { artifactSchemaKey, buildPrompt, packet, analysisTarget } = this.config
    const { analysisSessionId } = state

    const analysisSession = getSessionRecord(this.db.connection, analysisSessionId)
    if (!analysisSession) throw new Error(`Assessment: session not found: ${analysisSessionId}`)

    const injectPartIds: string[] = []
    const evidencePartIds: string[] = [
      packet.reasoning_before_part_id,
      packet.tool_call_part_id,
      packet.reasoning_after_part_id,
    ].filter((id): id is string => id !== null)

    const { toolCallPartIds, toolResultPartIds } = await runDeterministicMcpToolCallsInSingleTurn(
      this.db,
      this.mcp,
      analysisSession,
      evidencePartIds.map(partId => ({ toolName: 'mcpscope_inspect', toolArgs: { id: partId } })),
      ctx.emitSink,
      this.stepId,
    )
    injectPartIds.push(...toolCallPartIds, ...toolResultPartIds)

    const assessmentQuestion = buildPrompt({
      analysisTarget,
      subjectId: packet.tool_call_part_id,
      turnId: packet.turn_id,
      roundId: packet.round_id,
      toolCallPartId: packet.tool_call_part_id,
      toolName: packet.tool_name,
      toolCallParameters: packet.tool_call_parameters,
      preReasoningPartId: packet.reasoning_before_part_id,
      postReasoningPartId: packet.reasoning_after_part_id,
    })

    const turnResult = await runAnalysisTurn(
      this.db, this.lm, this.mcp, analysisSessionId,
      assessmentQuestion, ctx.emitSink, this.stepId,
    )

    const parseTs = now()
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(extractJsonBlock(turnResult.responseText))
    } catch (e) {
      this.writeDiagnostic(analysisSessionId, packet, 'json_parse_error',
        'LLM response was not valid JSON',
        { raw_response: turnResult.responseText, error: String(e) }, parseTs)
      this.setErrorPhase(state)
      return { status: 'error', outputArtifacts: [] }
    }

    const parsed = evaluationResultSchema.safeParse(parsedJson)
    if (!parsed.success) {
      this.writeDiagnostic(analysisSessionId, packet, 'schema_validation_error',
        'LLM response did not match evaluation_result schema',
        { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues }, parseTs)
      this.setErrorPhase(state)
      return { status: 'error', outputArtifacts: [] }
    }

    if (!validateAssessmentIdentity(packet, parsed.data)) {
      this.writeDiagnostic(analysisSessionId, packet, 'identity_mismatch',
        'LLM response matched the schema but not the expected packet identity',
        {
          raw_response: turnResult.responseText,
          expected: { subject_scope: 'tool_call', subject_id: packet.tool_call_part_id },
          actual: { subject_scope: parsed.data.subject_scope, subject_id: parsed.data.subject_id },
        }, parseTs)
      this.setErrorPhase(state)
      return { status: 'error', outputArtifacts: [] }
    }

    insertJsonArtifact(this.db.connection, {
      id: uuid(),
      sessionId: analysisSessionId,
      stepId: this.stepId,
      content: parsed.data,
      metadata: {
        schema_key: artifactSchemaKey,
        tool_call_part_id: packet.tool_call_part_id,
        turn_id: packet.turn_id,
        round_id: packet.round_id,
        tool_name: packet.tool_name,
        subject_scope: parsed.data.subject_scope,
        subject_id: parsed.data.subject_id,
      },
      createdAt: parseTs,
    })

    this.mutateContextAfterAssessment(
      analysisSessionId, injectPartIds,
      turnResult.assistantReasoningPartIds, turnResult.turnId,
    )

    return { status: 'complete', outputArtifacts: [] }
  }

  private writeDiagnostic(
    analysisSessionId: string, packet: EvidencePacket,
    errorKind: string, message: string, detail: unknown, ts: number,
  ): void {
    insertJsonArtifact(this.db.connection, {
      id: uuid(),
      sessionId: analysisSessionId,
      stepId: this.stepId,
      content: { step_type: 'tool_call_assessment', error_kind: errorKind, message, detail },
      metadata: {
        schema_key: SCHEMA_KEY.DIAGNOSTIC,
        tool_call_part_id: packet.tool_call_part_id,
        turn_id: packet.turn_id,
        round_id: packet.round_id,
      },
      createdAt: ts,
    })
  }

  private setErrorPhase(_state: AnalysisSessionState): void {
  }

  private mutateContextAfterAssessment(
    analysisSessionId: string,
    injectPartIds: string[], reasoningPartIds: string[], userTurnId: string | null,
  ): void {
    const mutatedAt = Date.now()
    const conn = this.db.connection
    for (const partId of injectPartIds) {
      const part = getPartRecord(conn, partId)
      if (part) updatePartRecord(conn, { ...part, context: { ...part.context, state: 'excluded', note: 'Deterministic inspect evidence excluded after assessment completed' }, updatedAt: mutatedAt })
    }
    for (const partId of reasoningPartIds) {
      const part = getPartRecord(conn, partId)
      if (part) updatePartRecord(conn, { ...part, context: { ...part.context, state: 'excluded', note: 'Assessment reasoning excluded after assessment completed (keeping assistant-content)' }, updatedAt: mutatedAt })
    }
    if (userTurnId) {
      const sessionParts = listPartRecordsBySession(conn, analysisSessionId)
      const userPart = sessionParts.find(p => p.turnId === userTurnId && p.partType === 'user-message')
      if (userPart) updatePartRecord(conn, { ...userPart, context: { ...userPart.context, state: 'historical-only', note: 'Assessment question excluded from active context after assessment completed' }, updatedAt: mutatedAt })
    }
  }
}

function validateAssessmentIdentity(
  packet: EvidencePacket,
  parsed: Pick<EvaluationResult, 'subject_scope' | 'subject_id'>,
): boolean {
  if (parsed.subject_scope !== 'tool_call') return false
  if (parsed.subject_id !== packet.tool_call_part_id) return false
  return true
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
