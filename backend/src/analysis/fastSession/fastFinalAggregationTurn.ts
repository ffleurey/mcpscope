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
  type EvaluationResult,
} from '../schemas.js'
import type { ZodError } from 'zod'
import { buildFastSessionFinalAggregationPrompt } from './evaluationPrompts.js'

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

export interface FastFinalAggregationInput {
  state: AnalysisSessionState
  stepId: string
}

export interface FastFinalAggregationResult {
  updatedState: AnalysisSessionState
  reportArtifactId: string | null
  success: boolean
}

function validateIdentity(sessionId: string, parsed: Pick<EvaluationResult, 'subject_scope' | 'subject_id'>): string[] {
  const failures: string[] = []
  if (parsed.subject_scope !== 'session') {
    failures.push(`subject_scope mismatch: expected session, got ${parsed.subject_scope}`)
  }
  if (parsed.subject_id !== sessionId) {
    failures.push(`subject_id mismatch: expected ${sessionId}, got ${parsed.subject_id}`)
  }
  return failures
}

function buildDeterministicReport(
  sessionId: string,
  assessments: EvaluationResult[],
  turnSummaries: EvaluationResult[],
): EvaluationResult | null {
  if (turnSummaries.length !== 1 || assessments.length === 0) {
    return null
  }

  const summary = turnSummaries[0]
  if (!summary) {
    return null
  }

  const severeAssessment = assessments.find(assessment => assessment.verdict === 'fail' || assessment.score <= 2)
  if (severeAssessment) {
    return null
  }

  return {
    subject_scope: 'session',
    subject_id: sessionId,
    evaluation_focus: 'Summarize the overall quality and outcome of the fast-session analysis.',
    reasoning: summary.reasoning,
    verdict: summary.verdict,
    score: summary.score,
    evidence_part_id: summary.evidence_part_id ?? assessments[0]?.evidence_part_id ?? null,
  }
}

export async function runFastFinalAggregationTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  input: FastFinalAggregationInput,
  emitEvent?: AnalysisStreamEventSink,
): Promise<FastFinalAggregationResult> {
  const { state, stepId } = input
  const analysisSession = getSessionRecord(database.connection, state.analysisSessionId)
  if (!analysisSession) {
    throw new Error(`Fast final aggregation: analysis session not found: ${state.analysisSessionId}`)
  }

  const targetArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.ANALYSIS_TARGET,
  )
  if (!targetArtifact) {
    throw new Error('Fast final aggregation: analysis_target artifact missing')
  }
  const analysisTarget = targetArtifact.content as AnalysisTarget
  const assessments = listArtifactsBySessionAndSchemaKey(
    database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.FAST_TOOL_CALL_ASSESSMENT,
  ).map(artifact => artifact.content as EvaluationResult)
  const turnSummaries = listArtifactsBySessionAndSchemaKey(
    database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.FAST_TURN_SUMMARY,
  ).map(artifact => artifact.content as EvaluationResult)

  const deterministicReport = buildDeterministicReport(state.analysisSessionId, assessments, turnSummaries)
  if (deterministicReport) {
    const reportArtifactId = uuid()
    insertJsonArtifact(database.connection, {
      id: reportArtifactId,
      sessionId: state.analysisSessionId,
      stepId,
      content: deterministicReport,
      metadata: {
        schema_key: SCHEMA_KEY.FAST_FINAL_ANALYSIS_REPORT,
        target_session_id: state.targetSessionId,
        target_turn_id: state.targetTurnId,
        total_packets: assessments.length,
        subject_scope: deterministicReport.subject_scope,
        subject_id: deterministicReport.subject_id,
      },
      createdAt: now(),
    })

    return {
      updatedState: {
        ...state,
        phase: 'complete',
        finalAggregationComplete: true,
      },
      reportArtifactId,
      success: true,
    }
  }

  const question = buildFastSessionFinalAggregationPrompt({
    analysisTarget,
    subjectId: state.analysisSessionId,
    assessmentCount: assessments.length,
    turnSummaryCount: turnSummaries.length,
  })

  const turnResult = await runAnalysisTurn(
    database,
    lmGateway,
    mcpGateway,
    state.analysisSessionId,
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
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_final_aggregation',
        error_kind: 'json_parse_error',
        message: 'Fast final aggregation response was not valid JSON',
        detail: { raw_response: turnResult.responseText, error: String(error) },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, reportArtifactId: null, success: false }
  }

  const parsed = evaluationResultSchema.safeParse(parsedJson)
  if (!parsed.success) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_final_aggregation',
        error_kind: 'schema_validation_error',
        message: 'Fast final aggregation response did not match evaluation_result schema',
        detail: { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, reportArtifactId: null, success: false }
  }

  const identityFailures = validateIdentity(state.analysisSessionId, parsed.data)
  if (identityFailures.length > 0) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_final_aggregation',
        error_kind: 'identity_mismatch',
        message: 'Fast final aggregation matched schema but not expected identity',
        detail: { failures: identityFailures, raw_response: turnResult.responseText },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, reportArtifactId: null, success: false }
  }

  const reportArtifactId = uuid()
  insertJsonArtifact(database.connection, {
    id: reportArtifactId,
    sessionId: state.analysisSessionId,
    stepId,
    content: parsed.data,
    metadata: {
      schema_key: SCHEMA_KEY.FAST_FINAL_ANALYSIS_REPORT,
      target_session_id: state.targetSessionId,
      target_turn_id: state.targetTurnId,
      total_packets: assessments.length,
      subject_scope: parsed.data.subject_scope,
      subject_id: parsed.data.subject_id,
    },
    createdAt: ts,
  })

  return {
    updatedState: {
      ...state,
      phase: 'complete',
      finalAggregationComplete: true,
    },
    reportArtifactId,
    success: true,
  }
}
