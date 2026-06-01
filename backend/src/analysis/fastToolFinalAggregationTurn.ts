import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import { getSessionRecord } from '../persistence/repository.js'
import {
  getLatestArtifactBySchemaKey,
  insertJsonArtifact,
  listArtifactsBySessionAndSchemaKey,
} from './artifactRepository.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { runAnalysisTurn } from './boundedTurn.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import {
  buildAnalysisFocusInstructions,
  fastToolFinalReportSchema,
  SCHEMA_KEY,
  type AnalysisSessionState,
  type AnalysisTarget,
  type FastToolGroupedAssessment,
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

export interface FastToolFinalAggregationInput {
  state: AnalysisSessionState
  stepId: string
}

export interface FastToolFinalAggregationResult {
  updatedState: AnalysisSessionState
  reportArtifactId: string | null
  success: boolean
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
  const groupedAssessments = listArtifactsBySessionAndSchemaKey(
    database.connection,
    state.analysisSessionId,
    SCHEMA_KEY.FAST_TOOL_GROUP_ASSESSMENT,
  ).map(artifact => artifact.content as FastToolGroupedAssessment)

  const totalToolCallsAssessed = groupedAssessments.reduce((sum, assessment) => sum + assessment.total_tool_calls, 0)
  const question = renderPromptResource('fast-tool.final-aggregation.txt', {
    analysis_focus_instructions: buildAnalysisFocusInstructions(analysisTarget),
    assessment_count: groupedAssessments.length,
    total_tool_call_count: totalToolCallsAssessed,
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

  const parsed = fastToolFinalReportSchema.safeParse(parsedJson)
  if (!parsed.success) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_tool_final_aggregation',
        error_kind: 'schema_validation_error',
        message: 'Fast tool final aggregation response did not match schema',
        detail: { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues },
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