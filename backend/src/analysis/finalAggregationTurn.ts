/**
 * AnalysisFinalAggregationTurn
 *
 * Aggregates all per-packet assessments into a final analysis report by running
 * one bounded LLM call. Writes a final_analysis_report artifact on success.
 */

import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import {
  getPartRecord,
  getSessionRecord,
} from '../persistence/repository.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
  listArtifactsBySessionAndSchemaKey,
} from './artifactRepository.js'
import { runBoundedAnalysisTurn } from './boundedTurn.js'
import {
  SCHEMA_KEY,
  finalAnalysisReportSchema,
  type AnalysisSessionState,
  type AnalysisTarget,
} from './schemas.js'
import type { ZodError } from 'zod'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export interface FinalAggregationInput {
  state: AnalysisSessionState
  stepId: string
}

export interface FinalAggregationResult {
  updatedState: AnalysisSessionState
  reportArtifactId: string | null
  success: boolean
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

export async function runFinalAggregationTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  input: FinalAggregationInput,
): Promise<FinalAggregationResult> {
  const { state, stepId } = input
  const { analysisSessionId } = state

  const analysisSession = getSessionRecord(database.connection, analysisSessionId)
  if (!analysisSession) {
    throw new Error(`Final aggregation: analysis session not found: ${analysisSessionId}`)
  }

  // ── Load artifacts ────────────────────────────────────────────────────────
  const targetArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.ANALYSIS_TARGET,
  )
  if (!targetArtifact) {
    throw new Error('Final aggregation: analysis_target artifact missing')
  }
  const analysisTarget = targetArtifact.content as AnalysisTarget

  const assessments = listArtifactsBySessionAndSchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
  ).map(a => a.content)

  // Load user request and final answer text
  const userRequestPart = analysisTarget.user_request_part_id
    ? getPartRecord(database.connection, analysisTarget.user_request_part_id)
    : null
  const finalAnswerPart = analysisTarget.final_answer_part_id
    ? getPartRecord(database.connection, analysisTarget.final_answer_part_id)
    : null

  const userRequestText = userRequestPart?.payload.text ?? '(not available)'
  const finalAnswerText = finalAnswerPart?.payload.text ?? '(not available)'

  // ── Build prompt ──────────────────────────────────────────────────────────
  const systemMessage = `You are a precise analysis assistant. Your job is to synthesize per-tool-call assessments into a coherent final analysis report.

Analysis goal: ${analysisTarget.analysis_goal}

You MUST respond with a single, valid JSON object that exactly matches the required schema. Do not include any prose, markdown, or explanation outside the JSON object.`

  const userMessage = `=== USER REQUEST ===
${userRequestText}

=== FINAL ANSWER PROVIDED BY THE LLM ===
${finalAnswerText}

=== PER-TOOL-CALL ASSESSMENTS (${assessments.length} total) ===
${JSON.stringify(assessments, null, 2)}

=== REQUIRED OUTPUT ===
Return exactly one JSON object with this shape (no prose, just JSON):
{
  "outcome": "answered" | "partially_answered" | "unsupported" | "unanswered",
  "outcome_rationale": "<2-3 sentences>",
  "primary_issue": "wrong_parameters" | "tool_misunderstanding" | "tool_description_clarity" | "tool_surface_mismatch" | "tool_limitation" | "unclear" | "none" | null,
  "primary_issue_rationale": "<2-3 sentences or null>",
  "path_efficiency": "efficient" | "mixed" | "inefficient",
  "path_efficiency_rationale": "<2-3 sentences>",
  "findings": ["<finding 1>", "<finding 2>", ...],
  "improvement_suggestions": ["<suggestion 1>", "<suggestion 2>", ...],
  "total_packets_assessed": ${assessments.length}
}`

  // ── Run bounded LLM call ──────────────────────────────────────────────────
  const turnResult = await runBoundedAnalysisTurn(
    database,
    lmGateway,
    {
      id: analysisSession.id,
      modelProfileSnapshot: {
        connectionBaseUrl: analysisSession.modelProfileSnapshot.connectionBaseUrl,
        modelKey: analysisSession.modelProfileSnapshot.modelKey,
        apiKey: analysisSession.modelProfileSnapshot.apiKey,
      },
    },
    [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
  )

  // ── Parse and validate ────────────────────────────────────────────────────
  const ts = now()
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(extractJsonBlock(turnResult.responseText))
  } catch (e) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'final_aggregation',
        error_kind: 'json_parse_error',
        message: 'Final aggregation LLM response was not valid JSON',
        detail: { raw_response: turnResult.responseText, error: String(e) },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return {
      updatedState: { ...state, phase: 'error' },
      reportArtifactId: null,
      success: false,
    }
  }

  const parsed = finalAnalysisReportSchema.safeParse(parsedJson)
  if (!parsed.success) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'final_aggregation',
        error_kind: 'schema_validation_error',
        message: 'Final aggregation response did not match final_analysis_report schema',
        detail: {
          raw_response: turnResult.responseText,
          errors: (parsed.error as ZodError).issues,
        },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return {
      updatedState: { ...state, phase: 'error' },
      reportArtifactId: null,
      success: false,
    }
  }

  // ── Write final report artifact ───────────────────────────────────────────
  const reportArtifactId = uuid()
  insertJsonArtifact(database.connection, {
    id: reportArtifactId,
    sessionId: analysisSessionId,
    stepId,
    content: parsed.data,
    metadata: {
      schema_key: SCHEMA_KEY.FINAL_ANALYSIS_REPORT,
      target_session_id: state.targetSessionId,
      target_turn_id: state.targetTurnId,
      total_packets: assessments.length,
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
