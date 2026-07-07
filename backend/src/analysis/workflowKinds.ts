export const ANALYSIS_WORKFLOW_KIND = {
  FULL_SESSION: 'full_session_analysis',
  FAST_SESSION: 'fast_session_analysis',
  FAST_TOOL: 'fast_tool_analysis',
  BENCHMARK_EVALUATION: 'benchmark_evaluation',
} as const

export type AnalysisWorkflowKind = typeof ANALYSIS_WORKFLOW_KIND[keyof typeof ANALYSIS_WORKFLOW_KIND]