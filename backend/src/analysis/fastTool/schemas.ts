import { z } from 'zod'

export const SCHEMA_KEY = {
  WORK_INDEX: 'analysis.fast_tool_work_index.v1',
  GROUP_ASSESSMENT: 'analysis.fast_tool_group_assessment.v1',
  FINAL_REPORT: 'analysis.fast_tool_final_report.v1',
} as const

export const fastToolFinalReportSchema = z.object({
  overall_tool_use_outcome: z.string().min(1),
  overall_rationale: z.string().min(1),
  tool_summaries: z.array(z.record(z.string(), z.unknown())),
  repeated_failure_patterns: z.array(z.unknown()),
  follow_up_candidates: z.array(z.unknown()),
  total_tool_groups_assessed: z.number().int().nonnegative().optional(),
  total_tool_calls_assessed: z.number().int().nonnegative().optional(),
}).passthrough()
export type FastToolFinalReport = z.infer<typeof fastToolFinalReportSchema>

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
