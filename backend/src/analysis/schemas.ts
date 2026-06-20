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
import type { RubricCriterion } from '../domain/model.js'

// ─────────────────────────────────────────────────────────────────────────────
// Schema key constants
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEMA_KEY = {
  ANALYSIS_TARGET: 'analysis.analysis_target.v1',
  EVIDENCE_PACKET_INDEX: 'analysis.evidence_packet_index.v1',
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
// Session state (stored in steps.state_json for the cursor step)
// ─────────────────────────────────────────────────────────────────────────────

export type AnalysisPhase =
  | 'bootstrap'
  | 'assessing'
  | 'turn_summary'
  | 'coverage_validation'
  | 'final_aggregation'
  | 'complete'
  | 'error'

export interface PlanProgress {
  /** Total number of commands in the current plan. */
  total: number
  /** Number of commands already completed. */
  completed: number
  /** Kind of the command currently being executed (or null if done). */
  currentCommandKind: string | null
  /** Semantic ID of the command currently being executed (or null if done). */
  currentCommandId: string | null
}

export interface AnalysisSessionState {
  phase: AnalysisPhase
  /** ID of the analysis (child) session. */
  analysisSessionId: string
  /** ID of the target (parent) session being analyzed. */
  targetSessionId: string
  /** ID of the turn at which analysis should stop (record of original scope). */
  targetTurnId: string
  /** The analysis goal text passed by the caller. */
  analysisGoal: string
  /** Optional tool-name filter applied during bootstrap. */
  selectedToolNames: string[]
  /** When true, only packets with an error tool result are analyzed. */
  onlyFailedToolCalls: boolean
  /** Optional extra evaluation criteria supplied by the user. */
  evaluationCriteria: string[]
  /** The analysis workflow kind, used for rehydration. */
  workflow_kind?: string
  /** Scored rubric for the benchmark_evaluation judge (empty for other kinds). */
  rubric?: RubricCriterion[]
  /**
   * Allow planning against a terminal-but-failed target turn (`error`/`aborted`) — set by
   * benchmark evaluation so a failed run-session is still judged. In-flight turns are never
   * planned against.
   */
  allowIncompleteTarget?: boolean
  /** Execution progress derived from the plan (updated after each step). */
  planProgress?: PlanProgress
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

// fullSession, fastSession, and fastTool report schemas live in their
// respective subclass directories: {subtype}/schemas.ts

// ─────────────────────────────────────────────────────────────────────────────
// analysis.evidence_packet_index.v1
// ─────────────────────────────────────────────────────────────────────────────
// analysis.evidence_packet_index.v1
// ─────────────────────────────────────────────────────────────────────────────

export const evidencePacketIndexSchema = z.object({
  packets: z.array(evidencePacketSchema),
})
export type EvidencePacketIndex = z.infer<typeof evidencePacketIndexSchema>

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
