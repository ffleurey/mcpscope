import { z } from 'zod'

export const SCHEMA_KEY = {
  TOOL_CALL_ASSESSMENT: 'analysis.tool_call_assessment.v1',
  TURN_SUMMARY: 'analysis.turn_summary.v1',
  FINAL_ANALYSIS_REPORT: 'analysis.final_analysis_report.v1',
} as const

export const finalAnalysisReportSchema = z.object({
  outcome: z.enum(['answered', 'partial', 'blocked', 'unclear']),
  outcome_rationale: z.string().min(1),
  primary_issue: z.string().nullable(),
  primary_issue_rationale: z.string().nullable(),
  path_efficiency: z.enum(['efficient', 'mixed', 'inefficient', 'unclear']),
  path_efficiency_rationale: z.string().min(1),
  findings: z.array(z.string()),
  tool_description_findings: z.array(z.string()),
  improvement_suggestions: z.array(z.string()),
  tool_description_improvement_suggestions: z.array(z.string()),
  total_tool_calls_assessed: z.number().int().nonnegative().optional(),
}).passthrough()
export type FinalAnalysisReport = z.infer<typeof finalAnalysisReportSchema>
