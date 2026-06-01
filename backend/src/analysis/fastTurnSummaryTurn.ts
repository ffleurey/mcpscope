import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import { getSessionRecord } from '../persistence/repository.js'
import {
  getLatestArtifactBySchemaKey,
  insertJsonArtifact,
} from './artifactRepository.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { runAnalysisTurn } from './boundedTurn.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import {
  buildAnalysisFocusInstructions,
  fastTurnSummarySchema,
  SCHEMA_KEY,
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvidencePacketIndex,
} from './schemas.js'
import type { ZodError } from 'zod'
import { renderPromptResource } from './promptResources.js'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
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

export interface FastTurnSummaryInput {
  state: AnalysisSessionState
  stepId: string
}

export interface FastTurnSummaryResult {
  updatedState: AnalysisSessionState
  summaryArtifactId: string | null
  success: boolean
}

function validateIdentity(
  currentTurnId: string,
  turnPackets: EvidencePacketIndex['packets'],
  parsed: ReturnType<typeof fastTurnSummarySchema.parse>,
): string[] {
  const failures: string[] = []
  if (parsed.turn_id !== currentTurnId) {
    failures.push(`turn_id mismatch: expected ${currentTurnId}, got ${parsed.turn_id}`)
  }
  if (parsed.total_tool_calls_assessed !== turnPackets.length) {
    failures.push(`total_tool_calls_assessed mismatch: expected ${turnPackets.length}, got ${parsed.total_tool_calls_assessed}`)
  }

  const expectedIds = new Set(turnPackets.map(packet => packet.tool_call_part_id))
  for (const finding of parsed.per_tool_findings) {
    if (!expectedIds.has(finding.tool_call_part_id)) {
      failures.push(`unexpected tool_call_part_id in summary: ${finding.tool_call_part_id}`)
    }
  }
  for (const candidate of parsed.follow_up_candidates) {
    if (!expectedIds.has(candidate)) {
      failures.push(`unexpected follow_up_candidate: ${candidate}`)
    }
  }
  return failures
}

export async function runFastTurnSummaryTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  input: FastTurnSummaryInput,
  emitEvent?: AnalysisStreamEventSink,
): Promise<FastTurnSummaryResult> {
  const { state, stepId } = input
  const { analysisSessionId, currentTurnId } = state
  if (!currentTurnId) {
    throw new Error('FastTurnSummaryTurn: currentTurnId is null')
  }

  const analysisSession = getSessionRecord(database.connection, analysisSessionId)
  if (!analysisSession) {
    throw new Error(`FastTurnSummaryTurn: analysis session not found: ${analysisSessionId}`)
  }

  const packetIndexArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
  )
  const packetIndex = packetIndexArtifact?.content as EvidencePacketIndex | undefined
  const turnPackets = packetIndex?.packets.filter(packet => packet.turn_id === currentTurnId) ?? []
  const analysisTargetArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.ANALYSIS_TARGET,
  )
  if (!analysisTargetArtifact) {
    throw new Error('FastTurnSummaryTurn: analysis_target artifact missing')
  }
  const analysisTarget = analysisTargetArtifact.content as AnalysisTarget
  const repeatedTools = [...new Set(
    turnPackets
      .map(packet => packet.tool_name)
      .filter((toolName, index, all) => all.indexOf(toolName) !== index),
  )]
  const question = renderPromptResource('fast-session.turn-summary.txt', {
    analysis_focus_instructions: buildAnalysisFocusInstructions(analysisTarget),
    current_turn_id: currentTurnId,
    turn_packet_count: turnPackets.length,
    repeated_tools: repeatedTools.length > 0 ? repeatedTools.join(', ') : 'none',
  })

  const turnResult = await runAnalysisTurn(
    database,
    lmGateway,
    mcpGateway,
    analysisSessionId,
    question,
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
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_turn_summary',
        error_kind: 'json_parse_error',
        message: 'Fast turn summary response was not valid JSON',
        detail: { raw_response: turnResult.responseText, error: String(error), turn_id: currentTurnId },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, summaryArtifactId: null, success: false }
  }

  const parsed = fastTurnSummarySchema.safeParse(parsedJson)
  if (!parsed.success) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_turn_summary',
        error_kind: 'schema_validation_error',
        message: 'Fast turn summary response did not match schema',
        detail: { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, summaryArtifactId: null, success: false }
  }

  const identityFailures = validateIdentity(currentTurnId, turnPackets, parsed.data)
  if (identityFailures.length > 0) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_turn_summary',
        error_kind: 'identity_mismatch',
        message: 'Fast turn summary matched schema but not expected identity',
        detail: { failures: identityFailures, raw_response: turnResult.responseText },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, summaryArtifactId: null, success: false }
  }

  const summaryArtifactId = uuid()
  insertJsonArtifact(database.connection, {
    id: summaryArtifactId,
    sessionId: analysisSessionId,
    stepId,
    content: parsed.data,
    metadata: {
      schema_key: SCHEMA_KEY.FAST_TURN_SUMMARY,
      turn_id: currentTurnId,
      total_assessed: turnPackets.length,
    },
    createdAt: ts,
  })

  return {
    updatedState: {
      ...state,
      phase: state.nextPacketIndex < state.packetCount ? 'assessing' : 'coverage_validation',
      currentTurnId: null,
    },
    summaryArtifactId,
    success: true,
  }
}