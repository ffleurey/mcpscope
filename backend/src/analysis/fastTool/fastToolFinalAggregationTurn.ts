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
  type FastToolWorkIndex,
} from '../schemas.js'
import type { ZodError } from 'zod'
import { buildFastToolFinalAggregationPrompt } from './evaluationPrompts.js'

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

export interface FastToolFinalAggregationInput {
  state: AnalysisSessionState
  stepId: string
}

export interface FastToolFinalAggregationResult {
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
  groupedAssessments: EvaluationResult[],
): EvaluationResult | null {
  if (groupedAssessments.length !== 1) {
    return null
  }

  const assessment = groupedAssessments[0]
  if (!assessment || assessment.verdict === 'fail') {
    return null
  }

  return {
    subject_scope: 'session',
    subject_id: sessionId,
    evaluation_focus: 'Summarize the overall quality and outcome of the fast-tool analysis.',
    reasoning: assessment.reasoning,
    verdict: assessment.verdict,
    score: assessment.score,
    evidence_part_id: assessment.evidence_part_id ?? null,
  }
}

export async function runFastToolFinalAggregationTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  input: FastToolFinalAggregationInput,
  emitEvent?: AnalysisStreamEventSink,
): Promise<FastToolFinalAggregationResult> {
  const { state, stepId } = input
  const analysisSession = getSessionRecord(database.connection, state.analysisSessionId)
  if (!analysisSession) {
    throw new Error(`Fast tool final aggregation: analysis session not found: ${state.analysisSessionId}`)
  }

  const targetArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.ANALYSIS_TARGET,
  )
  const workIndexArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.FAST_TOOL_WORK_INDEX,
  )
  if (!targetArtifact || !workIndexArtifact) {
    throw new Error('Fast tool final aggregation: required planning artifacts missing')
  }

  const analysisTarget = targetArtifact.content as AnalysisTarget
  const workIndex = workIndexArtifact.content as FastToolWorkIndex
  const groupedAssessments = listArtifactsBySessionAndSchemaKey(
    database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.FAST_TOOL_GROUP_ASSESSMENT,
  ).map(artifact => artifact.content as EvaluationResult)
  const totalToolCallCount = workIndex.tool_groups.reduce(
    (sum, toolGroup) => sum + toolGroup.tool_call_part_ids.length,
    0,
  )

  if (groupedAssessments.length !== workIndex.tool_groups.length) {
    return { updatedState: { ...state, phase: 'error' }, reportArtifactId: null, success: false }
  }

  const deterministicReport = buildDeterministicReport(state.analysisSessionId, groupedAssessments)
  if (deterministicReport) {
    const reportArtifactId = uuid()
    insertJsonArtifact(database.connection, {
      id: reportArtifactId,
      sessionId: state.analysisSessionId,
      stepId,
      content: deterministicReport,
      metadata: {
        schema_key: SCHEMA_KEY.FAST_TOOL_FINAL_REPORT,
        target_session_id: state.targetSessionId,
        target_turn_id: state.targetTurnId,
        total_assessments: groupedAssessments.length,
        total_tool_calls: totalToolCallCount,
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

  const question = buildFastToolFinalAggregationPrompt({
    analysisTarget,
    subjectId: state.analysisSessionId,
    assessmentCount: groupedAssessments.length,
    totalToolCallCount,
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
        step_type: 'fast_tool_final_aggregation',
        error_kind: 'json_parse_error',
        message: 'Fast tool final aggregation response was not valid JSON',
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
        step_type: 'fast_tool_final_aggregation',
        error_kind: 'schema_validation_error',
        message: 'Fast tool final aggregation response did not match evaluation_result schema',
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
        step_type: 'fast_tool_final_aggregation',
        error_kind: 'identity_mismatch',
        message: 'Fast tool final aggregation matched schema but not expected identity',
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
      schema_key: SCHEMA_KEY.FAST_TOOL_FINAL_REPORT,
      target_session_id: state.targetSessionId,
      target_turn_id: state.targetTurnId,
      total_assessments: groupedAssessments.length,
      total_tool_calls: totalToolCallCount,
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
