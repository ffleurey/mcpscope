import crypto from 'node:crypto'
import type { BackendDatabase } from '../../persistence/db.js'
import type { LmStudioGateway } from '../../runtime/modelTurns.js'
import { getSessionRecord } from '../../persistence/repository.js'
import {
  getLatestArtifactBySchemaKey,
  insertJsonArtifact,
  listArtifactsBySessionAndSchemaKey,
} from '../artifactRepository.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import { runAnalysisTurn } from '../boundedTurn.js'
import type { AnalysisStreamEventSink } from '../../runtime/streamEvents.js'
import {
  SCHEMA_KEY,
  evaluationResultSchema,
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvidencePacketIndex,
  type EvaluationResult,
} from '../schemas.js'
import type { ZodError } from 'zod'
import { buildFastSessionTurnSummaryPrompt } from './evaluationPrompts.js'

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

function validateIdentity(currentTurnId: string, parsed: Pick<EvaluationResult, 'subject_scope' | 'subject_id'>): string[] {
  const failures: string[] = []
  if (parsed.subject_scope !== 'turn') {
    failures.push(`subject_scope mismatch: expected turn, got ${parsed.subject_scope}`)
  }
  if (parsed.subject_id !== currentTurnId) {
    failures.push(`subject_id mismatch: expected ${currentTurnId}, got ${parsed.subject_id}`)
  }
  return failures
}

function buildDeterministicSummary(
  currentTurnId: string,
  turnPackets: EvidencePacketIndex['packets'],
  assessments: EvaluationResult[],
): EvaluationResult | null {
  if (turnPackets.length !== 1 || assessments.length !== 1) {
    return null
  }

  const assessment = assessments[0]
  if (!assessment) {
    return null
  }

  return {
    subject_scope: 'turn',
    subject_id: currentTurnId,
    evaluation_focus: 'Summarize the overall quality of this turn’s tool usage.',
    reasoning: assessment.reasoning,
    verdict: assessment.verdict,
    score: assessment.score,
    evidence_part_id: assessment.evidence_part_id ?? null,
  }
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
  const repeatedTools = [...new Set(turnPackets.map(packet => packet.tool_name))]

  const assessmentArtifacts = listArtifactsBySessionAndSchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.FAST_TOOL_CALL_ASSESSMENT,
  ).map(artifact => artifact.content as EvaluationResult)

  const assessmentsForTurn = assessmentArtifacts.filter(
    assessment => assessment.subject_scope === 'tool_call' && assessment.subject_id.length > 0,
  )
  const deterministicSummary = repeatedTools.length === 0
    ? buildDeterministicSummary(currentTurnId, turnPackets, assessmentsForTurn)
    : null

  if (deterministicSummary) {
    const summaryArtifactId = uuid()
    insertJsonArtifact(database.connection, {
      id: summaryArtifactId,
      sessionId: analysisSessionId,
      stepId,
      content: deterministicSummary,
      metadata: {
        schema_key: SCHEMA_KEY.FAST_TURN_SUMMARY,
        turn_id: currentTurnId,
        total_assessed: turnPackets.length,
        subject_scope: deterministicSummary.subject_scope,
        subject_id: deterministicSummary.subject_id,
      },
      createdAt: now(),
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

  const question = buildFastSessionTurnSummaryPrompt({
    analysisTarget,
    subjectId: currentTurnId,
    currentTurnId,
    turnPacketCount: turnPackets.length,
    repeatedTools: repeatedTools.length > 0 ? repeatedTools.join(', ') : 'none',
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

  const parsed = evaluationResultSchema.safeParse(parsedJson)
  if (!parsed.success) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_turn_summary',
        error_kind: 'schema_validation_error',
        message: 'Fast turn summary response did not match evaluation_result schema',
        detail: { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, summaryArtifactId: null, success: false }
  }

  const identityFailures = validateIdentity(currentTurnId, parsed.data)
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
      subject_scope: parsed.data.subject_scope,
      subject_id: parsed.data.subject_id,
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
