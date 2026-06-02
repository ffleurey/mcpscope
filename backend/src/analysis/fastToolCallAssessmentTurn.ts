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
  buildAnalysisFocusInstructions,
  fastToolCallAssessmentSchema,
  SCHEMA_KEY,
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvidencePacket,
} from './schemas.js'
import type { ZodError } from 'zod'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { runContextMutationStep } from './contextMutationStep.js'
import { renderPromptResource } from './promptResources.js'

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

function validateAssessmentIdentity(packet: EvidencePacket, parsed: {
  turn_id: string
  round_id: string
  tool_call_part_id: string
  tool_name: string
}): string[] {
  const failures: string[] = []
  if (parsed.turn_id !== packet.turn_id) {
    failures.push(`turn_id mismatch: expected ${packet.turn_id}, got ${parsed.turn_id}`)
  }
  if (parsed.round_id !== packet.round_id) {
    failures.push(`round_id mismatch: expected ${packet.round_id}, got ${parsed.round_id}`)
  }
  if (parsed.tool_call_part_id !== packet.tool_call_part_id) {
    failures.push(`tool_call_part_id mismatch: expected ${packet.tool_call_part_id}, got ${parsed.tool_call_part_id}`)
  }
  if (parsed.tool_name !== packet.tool_name) {
    failures.push(`tool_name mismatch: expected ${packet.tool_name}, got ${parsed.tool_name}`)
  }
  return failures
}

function normalizeFastAssessmentPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }

  const normalized = { ...payload } as Record<string, unknown>
  if (normalized.result_status === 'tool_error') {
    normalized.result_status = 'response_error'
  }
  return normalized
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

  const parsed = fastToolCallAssessmentSchema.safeParse(normalizeFastAssessmentPayload(parsedJson))
  if (!parsed.success) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_tool_call_assessment',
        error_kind: 'schema_validation_error',
        message: 'Fast assessment response did not match fast schema',
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
    },
    createdAt: ts,
  })

  const { nextPhase } = runContextMutationStep(database, {
    analysisSessionId: state.analysisSessionId,
    currentTurnId: packet.turn_id,
    nextPacketIndex: state.nextPacketIndex + 1,
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
  return renderPromptResource('fast-session.tool-call-assessment.txt', {
    analysis_focus_instructions: buildAnalysisFocusInstructions(analysisTarget),
    turn_id: packet.turn_id,
    round_id: packet.round_id,
    tool_call_part_id: packet.tool_call_part_id,
    tool_name: packet.tool_name,
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