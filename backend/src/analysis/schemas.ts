/**
 * Zod schemas for all analysis v2 artifact types and workflow input/state.
 *
 * Schema keys (stable identifiers for machine-readable artifact retrieval):
 *   analysis.analysis_target.v1
 *   analysis.coverage_map.v1
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
  COVERAGE_MAP: 'analysis.coverage_map.v1',
  EVIDENCE_PACKET_INDEX: 'analysis.evidence_packet_index.v1',
  TOOL_CALL_ASSESSMENT: 'analysis.tool_call_assessment.v1',
  FINAL_ANALYSIS_REPORT: 'analysis.final_analysis_report.v1',
  DIAGNOSTIC: 'analysis.diagnostic.v1',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Workflow input
// ─────────────────────────────────────────────────────────────────────────────

export const launchAnalysisV2InputSchema = z.object({
  target_turn_id: z.string().min(1),
  analysis_goal: z.string().min(1),
  analysis_profile_id: z.string().optional(),
})
export type LaunchAnalysisV2Input = z.infer<typeof launchAnalysisV2InputSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Session state (stored in v2_steps.state_json for the cursor step)
// ─────────────────────────────────────────────────────────────────────────────

export type AnalysisPhase =
  | 'bootstrap'
  | 'assessing'
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
  /** True if the last assessment turn needs a context-mutation step first. */
  awaitingContextMutation: boolean
  /** ID of the analysis turn whose user-message part needs mutation. */
  pendingMutationTurnId: string | null
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence packet (unit of analysis work)
// ─────────────────────────────────────────────────────────────────────────────

export const evidencePacketSchema = z.object({
  /** Stable index (0-based) within the packet list. */
  packet_index: z.number().int().nonnegative(),
  turn_id: z.string(),
  round_id: z.string(),
  tool_call_part_id: z.string(),
  tool_name: z.string(),
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
  /** IDs of turns included in the analysis scope (up to and including target_turn_id). */
  analyzed_turn_ids: z.array(z.string()),
  user_request_part_id: z.string().nullable(),
  final_answer_part_id: z.string().nullable(),
})
export type AnalysisTarget = z.infer<typeof analysisTargetSchema>

// ─────────────────────────────────────────────────────────────────────────────
// analysis.evidence_packet_index.v1
// ─────────────────────────────────────────────────────────────────────────────

export const evidencePacketIndexSchema = z.object({
  packets: z.array(evidencePacketSchema),
})
export type EvidencePacketIndex = z.infer<typeof evidencePacketIndexSchema>

// ─────────────────────────────────────────────────────────────────────────────
// analysis.coverage_map.v1
// ─────────────────────────────────────────────────────────────────────────────

export const coverageEntrySchema = z.object({
  packet_index: z.number().int().nonnegative(),
  tool_call_part_id: z.string(),
  /** null until assessment is complete. */
  assessment_artifact_id: z.string().nullable(),
  assessed: z.boolean(),
})

export const coverageMapSchema = z.object({
  entries: z.array(coverageEntrySchema),
})
export type CoverageMap = z.infer<typeof coverageMapSchema>
export type CoverageEntry = z.infer<typeof coverageEntrySchema>

// ─────────────────────────────────────────────────────────────────────────────
// analysis.tool_call_assessment.v1
// ─────────────────────────────────────────────────────────────────────────────

export const toolCallAssessmentSchema = z.object({
  packet_index: z.number().int().nonnegative(),
  turn_id: z.string(),
  round_id: z.string(),
  tool_name: z.string(),
  /**
   * Did the tool call match what the context needed?
   * match | partial_match | mismatch | unclear
   */
  expectation_match: z.enum(['match', 'partial_match', 'mismatch', 'unclear']),
  expectation_rationale: z.string(),
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
  /**
   * How well was the tool result used in subsequent reasoning?
   * good | partial | poor | not_applicable | unclear
   */
  result_usage_quality: z.enum(['good', 'partial', 'poor', 'not_applicable', 'unclear']),
  result_usage_rationale: z.string(),
  notable_observations: z.string().optional(),
})
export type ToolCallAssessment = z.infer<typeof toolCallAssessmentSchema>

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
  /** Concrete suggestions for MCP tool surface improvements. */
  improvement_suggestions: z.array(z.string()),
  total_packets_assessed: z.number().int().nonnegative(),
})
export type FinalAnalysisReport = z.infer<typeof finalAnalysisReportSchema>

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
