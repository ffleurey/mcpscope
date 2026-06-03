import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import { getSessionRecord } from '../persistence/repository.js'
import { insertJsonArtifact } from './artifactRepository.js'
import {
  runDeterministicMcpToolCallsInSingleTurn,
  type McpGateway,
} from '../runtime/toolTurns.js'
import { runAnalysisTurn } from './boundedTurn.js'
import {
  SCHEMA_KEY,
  evaluationResultSchema,
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvidencePacket,
  type EvaluationResult,
} from './schemas.js'
import type { ZodError } from 'zod'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { runFastToolContextMutationStep } from './fastToolContextMutationStep.js'
import { buildFastSessionToolCallAssessmentPrompt } from './evaluationPromptFactory.js'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export interface FastAssessmentTurnInput {
  state: AnalysisSessionState
  stepId: string
  packet: EvidencePacket
  analysisTarget: AnalysisTarget
}

export interface FastAssessmentTurnResult {
  updatedState: AnalysisSessionState
  assessmentArtifactId: string | null
  success: boolean
  turnId: string
}

function validateAssessmentIdentity(
  packet: EvidencePacket,
  parsed: Pick<EvaluationResult, 'subject_scope' | 'subject_id'>,
): string[] {
  const failures: string[] = []
  if (parsed.subject_scope !== 'tool_call') {
    failures.push(`subject_scope mismatch: expected tool_call, got ${parsed.subject_scope}`)
  }
  if (parsed.subject_id !== packet.tool_call_part_id) {
    failures.push(`subject_id mismatch: expected ${packet.tool_call_part_id}, got ${parsed.subject_id}`)
  }
  return failures
}

export async function runFastToolCallAssessmentTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  input: FastAssessmentTurnInput,
  emitEvent?: AnalysisStreamEventSink,
): Promise<FastAssessmentTurnResult> {
  const { state, stepId, packet, analysisTarget } = input
  const analysisSession = getSessionRecord(database.connection, state.analysisSessionId)
  if (!analysisSession) {
    throw new Error(`Fast assessment turn: analysis session not found: ${state.analysisSessionId}`)
  }

  const injectPartIds: string[] = []
  const evidencePartIds: string[] = [
    packet.reasoning_before_part_id,
    packet.tool_call_part_id,
    packet.reasoning_after_part_id,
  ].filter((id): id is string => id !== null)

  const { toolCallPartIds, toolResultPartIds } = await runDeterministicMcpToolCallsInSingleTurn(
    database,
    mcpGateway,
    analysisSession,
    evidencePartIds.map(partId => ({
      toolName: 'mcpscope_inspect',
      toolArgs: { id: partId },
    })),
    emitEvent,
    stepId,
  )
  injectPartIds.push(...toolCallPartIds, ...toolResultPartIds)

  const turnResult = await runAnalysisTurn(
    database,
    lmGateway,
    mcpGateway,
    state.analysisSessionId,
    buildFastAssessmentQuestion(packet, analysisTarget),
    emitEvent,
    stepId,
  )

  const ts = now()
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(extractJsonBlock(turnResult.responseText))
  } catch (error) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_tool_call_assessment',
        error_kind: 'json_parse_error',
        message: 'Fast assessment response was not valid JSON',
        detail: { raw_response: turnResult.responseText, error: String(error) },
      },
      metadata: {
        schema_key: SCHEMA_KEY.DIAGNOSTIC,
        tool_call_part_id: packet.tool_call_part_id,
        turn_id: packet.turn_id,
        round_id: packet.round_id,
      },
      createdAt: ts,
    })
    return {
      updatedState: { ...state, phase: 'error' },
      assessmentArtifactId: null,
      success: false,
      turnId: turnResult.turnId,
    }
  }

  const parsed = evaluationResultSchema.safeParse(parsedJson)
  if (!parsed.success) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_tool_call_assessment',
        error_kind: 'schema_validation_error',
        message: 'Fast assessment response did not match evaluation_result schema',
        detail: {
          raw_response: turnResult.responseText,
          errors: (parsed.error as ZodError).issues,
        },
      },
      metadata: {
        schema_key: SCHEMA_KEY.DIAGNOSTIC,
        tool_call_part_id: packet.tool_call_part_id,
        turn_id: packet.turn_id,
        round_id: packet.round_id,
      },
      createdAt: ts,
    })
    return {
      updatedState: { ...state, phase: 'error' },
      assessmentArtifactId: null,
      success: false,
      turnId: turnResult.turnId,
    }
  }

  const identityFailures = validateAssessmentIdentity(packet, parsed.data)
  if (identityFailures.length > 0) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_tool_call_assessment',
        error_kind: 'identity_mismatch',
        message: 'Fast assessment response matched the schema but not the expected packet identity',
        detail: {
          raw_response: turnResult.responseText,
          expected_subject_scope: 'tool_call',
          expected_subject_id: packet.tool_call_part_id,
          actual_subject_scope: parsed.data.subject_scope,
          actual_subject_id: parsed.data.subject_id,
          failures: identityFailures,
        },
      },
      metadata: {
        schema_key: SCHEMA_KEY.DIAGNOSTIC,
        tool_call_part_id: packet.tool_call_part_id,
        turn_id: packet.turn_id,
        round_id: packet.round_id,
      },
      createdAt: ts,
    })
    return {
      updatedState: { ...state, phase: 'error' },
      assessmentArtifactId: null,
      success: false,
      turnId: turnResult.turnId,
    }
  }

  const assessmentArtifactId = uuid()
  insertJsonArtifact(database.connection, {
    id: assessmentArtifactId,
    sessionId: state.analysisSessionId,
    stepId,
    content: parsed.data,
    metadata: {
      schema_key: SCHEMA_KEY.FAST_TOOL_CALL_ASSESSMENT,
      tool_call_part_id: packet.tool_call_part_id,
      turn_id: packet.turn_id,
      round_id: packet.round_id,
      tool_name: packet.tool_name,
      subject_scope: parsed.data.subject_scope,
      subject_id: parsed.data.subject_id,
    },
    createdAt: ts,
  })

  const { nextPhase } = runFastToolContextMutationStep(database, {
    analysisSessionId: state.analysisSessionId,
    nextWorkUnitIndex: state.nextPacketIndex + 1,
    totalWorkUnitCount: state.packetCount,
    injectPartIds,
    reasoningPartIds: turnResult.assistantReasoningPartIds,
    userTurnId: turnResult.turnId,
  })

  return {
    updatedState: {
      ...state,
      currentTurnId: packet.turn_id,
      nextPacketIndex: state.nextPacketIndex + 1,
      phase: nextPhase,
    },
    assessmentArtifactId,
    success: true,
    turnId: turnResult.turnId,
  }
}

function buildFastAssessmentQuestion(packet: EvidencePacket, analysisTarget: AnalysisTarget): string {
  return buildFastSessionToolCallAssessmentPrompt({
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
}

function extractJsonBlock(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1)
  }
  return trimmed
}
