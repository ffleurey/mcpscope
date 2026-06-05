/**
 * AnalysisFinalAggregationTurn
 *
 * Aggregates all per-packet assessments into a final analysis report by running
 * one bounded LLM call. Writes a final_analysis_report artifact on success.
 */

import crypto from 'node:crypto'
import type { BackendDatabase } from '../../persistence/db.js'
import type { LmStudioGateway } from '../../runtime/modelTurns.js'
import {
  getSessionRecord,
  getPartRecord,
  updatePartRecord,
} from '../../persistence/repository.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
  listArtifactsBySessionAndSchemaKey,
} from '../artifactRepository.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import { runAnalysisTurn } from '../boundedTurn.js'
import type { AnalysisStreamEventSink } from '../../runtime/streamEvents.js'
import {
  evaluationResultSchema,
  finalAnalysisReportSchema,
  SCHEMA_KEY,
  type AnalysisSessionState,
  type AnalysisTarget,
  type FinalAnalysisReport,
  type EvaluationResult,
} from '../schemas.js'
import type { ZodError } from 'zod'
import { buildFinalAggregationEvaluationPrompt } from './evaluationPrompts.js'

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

function normalizeFinalReportIdentity(parsedJson: unknown): unknown {
  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    return parsedJson
  }

  return parsedJson
}

function retireFinalAggregationPromptContext(
  database: BackendDatabase,
  userPartId: string,
  assistantReasoningPartIds: string[],
): void {
  const updatedAt = now()

  if (userPartId) {
    const userPart = getPartRecord(database.connection, userPartId)
    if (userPart) {
      updatePartRecord(database.connection, {
        ...userPart,
        context: {
          ...userPart.context,
          state: 'historical-only',
          note: 'Final aggregation question excluded from active context after report completed',
        },
        updatedAt,
      })
    }
  }

  for (const partId of assistantReasoningPartIds) {
    const reasoningPart = getPartRecord(database.connection, partId)
    if (!reasoningPart) {
      continue
    }
    updatePartRecord(database.connection, {
      ...reasoningPart,
      context: {
        ...reasoningPart.context,
        state: 'excluded',
        note: 'Final aggregation reasoning excluded after report completed',
      },
      updatedAt,
    })
  }
}

function firstSentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return trimmed
  const sentence = trimmed.match(/^.*?[.!?](?:\s|$)/)
  return sentence?.[0]?.trim() ?? trimmed
}

function buildDeterministicFinalReport(
  analysisSessionId: string,
  assessments: EvaluationResult[],
  turnSummaries: EvaluationResult[],
): FinalAnalysisReport | null {
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
    outcome: summary.verdict === 'pass' ? 'answered' : summary.verdict === 'partial' ? 'partial' : summary.verdict === 'fail' ? 'blocked' : 'unclear',
    outcome_rationale: firstSentence(summary.reasoning),
    primary_issue: null,
    primary_issue_rationale: null,
    path_efficiency: 'efficient',
    path_efficiency_rationale: firstSentence(summary.reasoning),
    findings: [summary.reasoning],
    tool_description_findings: [],
    improvement_suggestions: [],
    tool_description_improvement_suggestions: [],
    total_tool_calls_assessed: assessments.length,
  }
}

export async function runFinalAggregationTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  input: FinalAggregationInput,
  emitEvent?: AnalysisStreamEventSink,
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
  )
  const turnSummaries = listArtifactsBySessionAndSchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.TURN_SUMMARY,
  )
  const typedAssessments = assessments.map(artifact => artifact.content as EvaluationResult)
  const typedTurnSummaries = turnSummaries.map(artifact => artifact.content as EvaluationResult)
  const deterministicReport = buildDeterministicFinalReport(analysisSessionId, typedAssessments, typedTurnSummaries)

  if (deterministicReport) {
    const reportArtifactId = uuid()
    insertJsonArtifact(database.connection, {
      id: reportArtifactId,
      sessionId: analysisSessionId,
      stepId,
      content: deterministicReport,
      metadata: {
        schema_key: SCHEMA_KEY.FINAL_ANALYSIS_REPORT,
        target_session_id: state.targetSessionId,
        target_turn_id: state.targetTurnId,
        total_packets: assessments.length,
        synthesis_mode: 'deterministic_success_path',
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

  // ── Build synthesis question ──────────────────────────────────────────────
  // The accumulated context already contains: system-prompt, mcp-instructions,
  // accepted assessment results, and turn summaries. Ask the LLM to consolidate.
  const synthesisQuestion = buildFinalAggregationEvaluationPrompt({
    analysisTarget,
    assessmentCount: assessments.length,
    turnSummaryCount: turnSummaries.length,
    subjectId: analysisSessionId,
  })

  // ── Run context-aware LLM turn ────────────────────────────────────────────
  const turnResult = await runAnalysisTurn(
    database,
    lmGateway,
    mcpGateway,
    analysisSessionId,
    synthesisQuestion,
    emitEvent,
    input.stepId,
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

  parsedJson = normalizeFinalReportIdentity(parsedJson)

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
  const finalReport: FinalAnalysisReport = {
    ...parsed.data,
    total_tool_calls_assessed: parsed.data.total_tool_calls_assessed ?? assessments.length,
  }
  insertJsonArtifact(database.connection, {
    id: reportArtifactId,
    sessionId: analysisSessionId,
    stepId,
    content: finalReport,
    metadata: {
      schema_key: SCHEMA_KEY.FINAL_ANALYSIS_REPORT,
      target_session_id: state.targetSessionId,
      target_turn_id: state.targetTurnId,
      total_packets: assessments.length,
      subject_scope: 'session',
      subject_id: analysisSessionId,
    },
    createdAt: ts,
  })

  retireFinalAggregationPromptContext(
    database,
    turnResult.userPartId,
    turnResult.assistantReasoningPartIds,
  )

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
