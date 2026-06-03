/**
 * Zod schemas for all analysis v2 artifact types and workflow input/state.
 *
 * Schema keys (stable identifiers for machine-readable artifact retrieval):
 *   analysis.analysis_target.v1
 *   analysis.evidence_packet_index.v1
 *   analysis.tool_call_assessment.v1
 *   analysis.final_analysis_report.v1
 *   analysis.diagnostic.v1
 */

import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Schema key constants
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEMA_KEY = {
  ANALYSIS_TARGET: 'analysis.analysis_target.v1',
  EVIDENCE_PACKET_INDEX: 'analysis.evidence_packet_index.v1',
  TOOL_CALL_ASSESSMENT: 'analysis.tool_call_assessment.v1',
  TURN_SUMMARY: 'analysis.turn_summary.v1',
  FINAL_ANALYSIS_REPORT: 'analysis.final_analysis_report.v1',
  EVALUATION_RESULT: 'analysis.evaluation_result.v1',
  FAST_TOOL_CALL_ASSESSMENT: 'analysis.fast_session_tool_call_assessment.v1',
  FAST_TURN_SUMMARY: 'analysis.fast_session_turn_summary.v1',
  FAST_FINAL_ANALYSIS_REPORT: 'analysis.fast_session_final_analysis_report.v1',
  FAST_TOOL_WORK_INDEX: 'analysis.fast_tool_work_index.v1',
  FAST_TOOL_GROUP_ASSESSMENT: 'analysis.fast_tool_group_assessment.v1',
  FAST_TOOL_FINAL_REPORT: 'analysis.fast_tool_final_report.v1',
  DIAGNOSTIC: 'analysis.diagnostic.v1',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Workflow input
// ─────────────────────────────────────────────────────────────────────────────

export const launchAnalysisV2InputSchema = z.object({
  target_turn_id: z.string().min(1),
  analysis_goal: z.string().min(1),
  model_config_id: z.string().optional(),
  additional_instructions: z.string().optional(),
  temperature: z.number().optional(),
  selected_tool_names: z.array(z.string().min(1)).optional(),
  only_failed_tool_calls: z.boolean().optional(),
  evaluation_criteria: z.array(z.string().min(1)).optional(),
})
export type LaunchAnalysisV2Input = z.infer<typeof launchAnalysisV2InputSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Session state (stored in v2_steps.state_json for the cursor step)
// ─────────────────────────────────────────────────────────────────────────────

export type AnalysisPhase =
  | 'bootstrap'
  | 'assessing'
  | 'turn_summary'
  | 'coverage_validation'
  | 'final_aggregation'
  | 'complete'
  | 'error'

export interface AnalysisSessionState {
  phase: AnalysisPhase
  /** True after AnalysisBootstrapStep completes. */
  bootstrapComplete: boolean
  /** Index of the next packet to assess (0-based). */
  nextPacketIndex: number
  /** Total number of packets discovered by bootstrap. */
  packetCount: number
  /** The turn_id of the target session turn currently being assessed. */
  currentTurnId: string | null
  /** True after AnalysisCoverageValidationStep completes successfully. */
  coverageValidated: boolean
  /** True after AnalysisFinalAggregationTurn completes. */
  finalAggregationComplete: boolean
  /** ID of the analysis (child) session. */
  analysisSessionId: string
  /** ID of the target (parent) session being analyzed. */
  targetSessionId: string
  /** ID of the turn at which analysis should stop. */
  targetTurnId: string
  /** The analysis goal text passed by the caller. */
  analysisGoal: string
  /** Optional tool-name filter applied during bootstrap. */
  selectedToolNames: string[]
  /** When true, only packets with an error tool result are analyzed. */
  onlyFailedToolCalls: boolean
  /** Optional extra evaluation criteria supplied by the user. */
  evaluationCriteria: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence packet (unit of analysis work)
// ─────────────────────────────────────────────────────────────────────────────

export const evidencePacketSchema = z.object({
  turn_id: z.string(),
  round_id: z.string(),
  tool_call_part_id: z.string(),
  tool_name: z.string(),
  tool_call_parameters: z.string(),
  reasoning_before_part_id: z.string().nullable(),
  tool_result_part_id: z.string().nullable(),
  reasoning_after_part_id: z.string().nullable(),
})
export type EvidencePacket = z.infer<typeof evidencePacketSchema>

// ─────────────────────────────────────────────────────────────────────────────
// analysis.analysis_target.v1
// ─────────────────────────────────────────────────────────────────────────────

export const analysisTargetSchema = z.object({
  target_session_id: z.string(),
  target_turn_id: z.string(),
  analysis_goal: z.string(),
  selected_tool_names: z.array(z.string()),
  only_failed_tool_calls: z.boolean(),
  evaluation_criteria: z.array(z.string()),
  /** IDs of turns included in the analysis scope (up to and including target_turn_id). */
  analyzed_turn_ids: z.array(z.string()),
  target_mcp_instructions_part_id: z.string().nullable(),
  target_tool_definitions_part_id: z.string().nullable(),
  user_request_part_id: z.string().nullable(),
  final_answer_part_id: z.string().nullable(),
})
export type AnalysisTarget = z.infer<typeof analysisTargetSchema>

export function buildAnalysisFocusInstructions(target: AnalysisTarget): string {
  const lines = [`Analysis goal: ${target.analysis_goal}`]

  if (target.evaluation_criteria.length > 0) {
    lines.push('', 'Evaluation criteria:')
    for (const criterion of target.evaluation_criteria) {
      lines.push(`- ${criterion}`)
    }
  }

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// analysis.evaluation_result.v1
// ─────────────────────────────────────────────────────────────────────────────

export const evaluationResultSchema = z.object({
  subject_scope: z.string().min(1),
  subject_id: z.string().min(1),
  evaluation_focus: z.string().min(1),
  reasoning: z.string().min(1),
  verdict: z.enum(['pass', 'partial', 'fail', 'unclear']),
  score: z.number().int().min(0).max(5),
  evidence_part_id: z.string().nullable().optional(),
})
export type EvaluationResult = z.infer<typeof evaluationResultSchema>

// ─────────────────────────────────────────────────────────────────────────────
// analysis.evidence_packet_index.v1
// ─────────────────────────────────────────────────────────────────────────────

export const evidencePacketIndexSchema = z.object({
  packets: z.array(evidencePacketSchema),
})
export type EvidencePacketIndex = z.infer<typeof evidencePacketIndexSchema>

// ─────────────────────────────────────────────────────────────────────────────
// analysis.tool_call_assessment.v1
// ─────────────────────────────────────────────────────────────────────────────

export const toolCallAssessmentSchema = z.object({
  turn_id: z.string(),
  round_id: z.string(),
  tool_call_part_id: z.string(),
  tool_name: z.string(),
  /**
   * Did the tool call match what the context needed?
   * match | partial_match | mismatch | unclear
   */
  expectation_match: z.enum(['match', 'partial_match', 'mismatch', 'unclear']),
  tool_call_assessment: z.string(),
  /**
   * The most direct cause of a mismatch (if applicable).
   * wrong_parameters | tool_misunderstanding | tool_description_clarity |
   * tool_surface_mismatch | tool_limitation | unclear
   */
  most_direct_cause: z
    .enum([
      'wrong_parameters',
      'tool_misunderstanding',
      'tool_description_clarity',
      'tool_surface_mismatch',
      'tool_limitation',
      'unclear',
    ])
    .nullable(),
  parameter_or_call_issues: z.array(z.string()),
  post_call_assessment: z.string().nullable(),
})
export type ToolCallAssessment = z.infer<typeof toolCallAssessmentSchema>

export const fastToolCallAssessmentSchema = z.object({
  tool_call_part_id: z.string(),
  tool_name: z.string(),
  tool_call_reasoning: z.string(),
  tool_call_result: z.enum([
    'successful',
    'partially_successful',
    'unsuccessful',
    'parameter_error',
    'response_error',
    'unclear',
  ]),
  tool_call_diagnostic: z.string().nullable().optional(),
})
export type FastToolCallAssessment = z.infer<typeof fastToolCallAssessmentSchema>

// ─────────────────────────────────────────────────────────────────────────────
// analysis.turn_summary.v1
// ─────────────────────────────────────────────────────────────────────────────

export const turnSummarySchema = z.object({
  turn_id: z.string(),
  total_tool_calls_assessed: z.number().int().nonnegative(),
  /**
   * Overall outcome for this turn's tool usage.
   * successful | partially_successful | failed | unclear
   */
  turn_outcome: z.enum(['successful', 'partially_successful', 'failed', 'unclear']),
  turn_outcome_rationale: z.string(),
  /** One-line finding per assessed tool call. */
  per_tool_findings: z.array(z.object({
    tool_call_part_id: z.string(),
    tool_name: z.string(),
    brief_finding: z.string(),
  })),
  cross_attempt_reconciliation: z.string().nullable(),
})
export type TurnSummary = z.infer<typeof turnSummarySchema>

export const fastTurnSummarySchema = z.object({
  turn_id: z.string(),
  total_tool_calls_assessed: z.number().int().nonnegative(),
  turn_outcome: z.enum(['answered', 'partially_answered', 'not_answered', 'unclear']),
  turn_outcome_rationale: z.string(),
  per_tool_findings: z.array(z.object({
    tool_call_part_id: z.string(),
    tool_name: z.string(),
    result_status: z.enum([
      'successful',
      'partially_successful',
      'unsuccessful',
      'parameter_error',
      'response_error',
      'unclear',
    ]),
    brief_finding: z.string(),
  })),
  cross_attempt_reconciliation: z.string().nullable(),
  follow_up_candidates: z.array(z.string()),
})
export type FastTurnSummary = z.infer<typeof fastTurnSummarySchema>

// ─────────────────────────────────────────────────────────────────────────────
// analysis.final_analysis_report.v1
// ─────────────────────────────────────────────────────────────────────────────

export const finalAnalysisReportSchema = z.object({
  /**
   * Overall outcome.
   * answered | partially_answered | unsupported | unanswered
   */
  outcome: z.enum(['answered', 'partially_answered', 'unsupported', 'unanswered']),
  outcome_rationale: z.string(),
  /**
   * Primary issue category (null if outcome is 'answered').
   * wrong_parameters | tool_misunderstanding | tool_description_clarity |
   * tool_surface_mismatch | tool_limitation | unclear | none
   */
  primary_issue: z
    .enum([
      'wrong_parameters',
      'tool_misunderstanding',
      'tool_description_clarity',
      'tool_surface_mismatch',
      'tool_limitation',
      'unclear',
      'none',
    ])
    .nullable(),
  primary_issue_rationale: z.string().nullable(),
  /**
   * Was the tool-call path efficient?
   * efficient | mixed | inefficient
   */
  path_efficiency: z.enum(['efficient', 'mixed', 'inefficient']),
  path_efficiency_rationale: z.string(),
  /** Top-level findings, one sentence each. */
  findings: z.array(z.string()),
  tool_description_findings: z.array(z.string()),
  /** Concrete suggestions for MCP tool surface improvements. */
  improvement_suggestions: z.array(z.string()),
  tool_description_improvement_suggestions: z.array(z.string()),
  total_tool_calls_assessed: z.number().int().nonnegative(),
})
export type FinalAnalysisReport = z.infer<typeof finalAnalysisReportSchema>

export const fastFinalAnalysisReportSchema = z.object({
  overall_outcome: z.enum(['answered', 'partially_answered', 'not_answered', 'unclear']),
  overall_rationale: z.string(),
  path_efficiency: z.enum(['efficient', 'mixed', 'inefficient', 'unclear']),
  tool_summaries: z.array(z.object({
    tool_name: z.string(),
    total_tool_calls: z.number().int().nonnegative(),
    successful_tool_calls: z.number().int().nonnegative(),
    request_error_tool_calls: z.number().int().nonnegative(),
    response_error_tool_calls: z.number().int().nonnegative(),
    empty_tool_calls: z.number().int().nonnegative(),
    inefficient_tool_calls: z.number().int().nonnegative(),
    summary: z.string(),
  })),
  notable_failures: z.array(z.object({
    tool_call_part_id: z.string(),
    tool_name: z.string(),
    result_status: z.enum([
      'successful',
      'partially_successful',
      'unsuccessful',
      'parameter_error',
      'response_error',
      'unclear',
    ]),
    reason: z.string(),
  })),
  follow_up_candidates: z.array(z.object({
    tool_call_part_id: z.string(),
    tool_name: z.string(),
    reason: z.string(),
    priority: z.enum(['medium', 'high']),
  })),
  total_tool_calls_assessed: z.number().int().nonnegative(),
})
export type FastFinalAnalysisReport = z.infer<typeof fastFinalAnalysisReportSchema>

export const fastToolWorkGroupSchema = z.object({
  work_unit_id: z.string(),
  tool_name: z.string(),
  tool_call_part_ids: z.array(z.string()),
  tool_result_part_ids: z.array(z.string()),
  reasoning_before_part_ids: z.array(z.string()),
  reasoning_after_part_ids: z.array(z.string()),
  turn_ids: z.array(z.string()),
  round_ids: z.array(z.string()),
})
export const fastToolWorkIndexSchema = z.object({
  tool_groups: z.array(fastToolWorkGroupSchema),
})
export type FastToolWorkGroup = z.infer<typeof fastToolWorkGroupSchema>
export type FastToolWorkIndex = z.infer<typeof fastToolWorkIndexSchema>

export const fastToolGroupedAssessmentSchema = z.object({
  work_unit_id: z.string(),
  tool_name: z.string(),
  tool_call_part_ids: z.array(z.string()),
  turn_ids: z.array(z.string()),
  total_tool_calls: z.number().int().nonnegative(),
  usefulness: z.enum(['high', 'mixed', 'low', 'none', 'unclear']),
  efficiency: z.enum(['efficient', 'acceptable', 'inefficient', 'unclear']),
  common_failure_mode: z.enum([
    'none',
    'wrong_tool',
    'wrong_parameters',
    'request_construction_error',
    'response_interpretation_error',
    'tool_error',
    'missing_evidence',
    'unclear',
  ]),
  summary: z.string(),
  follow_up_priority: z.enum(['none', 'low', 'medium', 'high']),
  notable_part_ids: z.array(z.string()),
})
export type FastToolGroupedAssessment = z.infer<typeof fastToolGroupedAssessmentSchema>

export const fastToolFinalReportSchema = z.object({
  overall_tool_use_outcome: z.enum(['strong', 'mixed', 'weak', 'unclear']),
  overall_rationale: z.string(),
  tool_summaries: z.array(z.object({
    work_unit_id: z.string(),
    tool_name: z.string(),
    usefulness: fastToolGroupedAssessmentSchema.shape.usefulness,
    efficiency: fastToolGroupedAssessmentSchema.shape.efficiency,
    common_failure_mode: fastToolGroupedAssessmentSchema.shape.common_failure_mode,
    summary: z.string(),
    follow_up_priority: fastToolGroupedAssessmentSchema.shape.follow_up_priority,
  })),
  repeated_failure_patterns: z.array(z.string()),
  follow_up_candidates: z.array(z.object({
    work_unit_id: z.string(),
    tool_name: z.string(),
    reason: z.string(),
    priority: z.enum(['medium', 'high']),
  })),
  total_tool_groups_assessed: z.number().int().nonnegative(),
  total_tool_calls_assessed: z.number().int().nonnegative(),
})
export type FastToolFinalReport = z.infer<typeof fastToolFinalReportSchema>

// ─────────────────────────────────────────────────────────────────────────────
// analysis.diagnostic.v1
// ─────────────────────────────────────────────────────────────────────────────

export const diagnosticSchema = z.object({
  step_type: z.string(),
  error_kind: z.string(),
  message: z.string(),
  detail: z.unknown().optional(),
})
export type Diagnostic = z.infer<typeof diagnosticSchema>
