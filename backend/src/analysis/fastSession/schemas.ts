import { z } from 'zod'

export const SCHEMA_KEY = {
  TOOL_CALL_ASSESSMENT: 'analysis.fast_session_tool_call_assessment.v1',
  TURN_SUMMARY: 'analysis.fast_session_turn_summary.v1',
  FINAL_ANALYSIS_REPORT: 'analysis.fast_session_final_analysis_report.v1',
} as const

export const fastSessionFinalAnalysisReportSchema = z.object({
  overall_outcome: z.string().min(1),
  overall_rationale: z.string().min(1),
  path_efficiency: z.enum(['efficient', 'mixed', 'inefficient', 'unclear']),
  tool_summaries: z.array(z.record(z.string(), z.unknown())),
  notable_failures: z.array(z.unknown()),
  follow_up_candidates: z.array(z.unknown()),
  total_tool_calls_assessed: z.number().int().nonnegative().optional(),
}).passthrough()
export type FastSessionFinalAnalysisReport = z.infer<typeof fastSessionFinalAnalysisReportSchema>
