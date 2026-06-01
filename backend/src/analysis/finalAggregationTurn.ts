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
  getSessionRecord,
  getPartRecord,
  updatePartRecord,
} from '../persistence/repository.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
  listArtifactsBySessionAndSchemaKey,
} from './artifactRepository.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { runAnalysisTurn } from './boundedTurn.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import {
  buildAnalysisFocusInstructions,
  SCHEMA_KEY,
  finalAnalysisReportSchema,
  type AnalysisSessionState,
  type AnalysisTarget,
  type FinalAnalysisReport,
  type ToolCallAssessment,
  type TurnSummary,
} from './schemas.js'
import type { ZodError } from 'zod'
import { renderPromptResource } from './promptResources.js'

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

function normalizeFinalReportIdentity(parsedJson: unknown, totalToolCallsAssessed: number): unknown {
  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    return parsedJson
  }

  return {
    ...parsedJson,
    total_tool_calls_assessed: totalToolCallsAssessed,
  }
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

function derivePrimaryIssue(assessments: ToolCallAssessment[]): FinalAnalysisReport['primary_issue'] {
  const causes = assessments
    .map(assessment => assessment.most_direct_cause)
    .filter((cause): cause is NonNullable<ToolCallAssessment['most_direct_cause']> => cause !== null && cause !== 'unclear')

  if (causes.length === 0) {
    return 'none'
  }

  const counts = new Map<string, number>()
  for (const cause of causes) {
    counts.set(cause, (counts.get(cause) ?? 0) + 1)
  }

  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1])
  const top = sorted[0]?.[0] ?? null
  const second = sorted[1]?.[1] ?? 0
  const topCount = sorted[0]?.[1] ?? 0

  if (top && topCount > second) {
    return top as FinalAnalysisReport['primary_issue']
  }

  return 'unclear'
}

function buildDocumentationFinding(assessments: ToolCallAssessment[]): string | null {
  for (const assessment of assessments) {
    const combined = `${assessment.tool_call_assessment} ${assessment.parameter_or_call_issues.join(' ')}`
    if (!/(tool description|documentation|contradict|states?|described|valid values)/i.test(combined)) {
      continue
    }
    return firstSentence(combined)
  }
  return null
}

function buildDocumentationSuggestion(assessments: ToolCallAssessment[]): string | null {
  for (const assessment of assessments) {
    const combined = `${assessment.tool_call_assessment} ${assessment.parameter_or_call_issues.join(' ')}`
    if (/aggregation/i.test(combined)) {
      return `Clarify whether ${assessment.tool_name} expects a single aggregation as a scalar string or a single-element array.`
    }
    if (/(tool description|documentation|contradict|described|valid values)/i.test(combined)) {
      return `Clarify the expected runtime contract for ${assessment.tool_name} so the documented parameter shape matches observed behavior.`
    }
  }
  return null
}

function buildDeterministicFinalReport(
  assessments: ToolCallAssessment[],
  turnSummaries: TurnSummary[],
): FinalAnalysisReport | null {
  if (turnSummaries.length !== 1) {
    return null
  }

  if (!turnSummaries.every(summary => summary.turn_outcome === 'successful')) {
    return null
  }

  const mismatchedAssessments = assessments.filter(assessment => assessment.expectation_match !== 'match')
  const issueTurnIds = new Set<string>()

  for (const summary of turnSummaries) {
    if (summary.cross_attempt_reconciliation) {
      issueTurnIds.add(summary.turn_id)
    }
  }
  for (const assessment of mismatchedAssessments) {
    issueTurnIds.add(assessment.turn_id)
  }

  if (issueTurnIds.size > 1) {
    return null
  }

  const issueTurnId = issueTurnIds.values().next().value as string | undefined
  const issueSummary = issueTurnId
    ? (turnSummaries.find(summary => summary.turn_id === issueTurnId) ?? null)
    : null
  const primaryIssue = derivePrimaryIssue(mismatchedAssessments)
  const documentationFinding = buildDocumentationFinding(mismatchedAssessments)
  const documentationSuggestion = buildDocumentationSuggestion(mismatchedAssessments)

  const findings: string[] = []
  if (issueSummary?.cross_attempt_reconciliation) {
    findings.push(firstSentence(issueSummary.cross_attempt_reconciliation))
  }
  for (const summary of turnSummaries) {
    const firstFinding = summary.per_tool_findings[0]?.brief_finding
    if (!firstFinding) {
      continue
    }
    const normalized = firstSentence(firstFinding)
    if (!findings.includes(normalized)) {
      findings.push(normalized)
    }
  }

  const answeredWithoutIssues = mismatchedAssessments.length === 0

  return {
    outcome: 'answered',
    outcome_rationale: answeredWithoutIssues
      ? 'The session answered the user request across the assessed turns without material tool-use issues.'
      : 'The session answered the user request, and the main tool-use issue was resolved within the workflow before the final answer was produced.',
    primary_issue: answeredWithoutIssues ? 'none' : primaryIssue,
    primary_issue_rationale: answeredWithoutIssues
      ? null
      : issueSummary?.cross_attempt_reconciliation
        ? firstSentence(issueSummary.cross_attempt_reconciliation)
        : firstSentence(mismatchedAssessments[0]?.tool_call_assessment ?? ''),
    path_efficiency: answeredWithoutIssues ? 'efficient' : 'mixed',
    path_efficiency_rationale: answeredWithoutIssues
      ? 'The assessed turns reached the required answer path directly without retries or corrective tool-call changes.'
      : 'The workflow still reached the correct answer, but it required retries or a corrected tool-call shape before succeeding.',
    findings,
    tool_description_findings: documentationFinding ? [documentationFinding] : [],
    improvement_suggestions: [],
    tool_description_improvement_suggestions: documentationSuggestion ? [documentationSuggestion] : [],
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
  const typedAssessments = assessments.map(artifact => artifact.content as ToolCallAssessment)
  const typedTurnSummaries = turnSummaries.map(artifact => artifact.content as TurnSummary)
  const deterministicReport = buildDeterministicFinalReport(typedAssessments, typedTurnSummaries)

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
  const synthesisQuestion = renderPromptResource('full.final-aggregation.txt', {
    analysis_focus_instructions: buildAnalysisFocusInstructions(analysisTarget),
    assessment_count: assessments.length,
    turn_summary_count: turnSummaries.length,
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

  parsedJson = normalizeFinalReportIdentity(parsedJson, assessments.length)

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
