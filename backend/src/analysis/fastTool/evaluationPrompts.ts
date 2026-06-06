import type { AnalysisTarget } from '../schemas.js'
import { buildAnalysisFocusInstructions } from '../schemas.js'
import { buildSharedEvaluationPrompt } from '../evaluationPromptShared.js'

export function buildFastToolGroupedAssessmentPrompt(params: {
  analysisTarget: AnalysisTarget
  subjectId: string
  workUnitId: string
  toolName: string
  toolCallPartIds: string[]
  turnIds: string[]
  totalToolCalls: number
}): string {
  return buildSharedEvaluationPrompt({
    title: 'a grouped tool work unit in a fast-tool analysis session',
    subjectScope: 'work_unit',
    subjectId: params.subjectId,
    evaluationFocus: buildAnalysisFocusInstructions(params.analysisTarget),
    contextBlock: [
      'Work unit context:',
      `- work_unit_id: ${params.workUnitId}`,
      `- tool_name: ${params.toolName}`,
      `- total_tool_calls: ${params.totalToolCalls}`,
      `- tool_call_part_ids: ${params.toolCallPartIds.join(', ')}`,
      `- turn_ids: ${params.turnIds.join(', ')}`,
    ].join('\n'),
    extraInstructions: 'Focus on the qualitative value of the grouped work unit and its tool contract.',
  })
}

export function buildFastToolFinalAggregationPrompt(params: {
  analysisTarget: AnalysisTarget
  assessmentCount: number
  totalToolCallCount: number
}): string {
  const sections = [
    'You are evaluating the overall fast-tool analysis outcome.',
    '',
    'Fast-tool aggregation context:',
    `- assessment_count: ${params.assessmentCount}`,
    `- total_tool_call_count: ${params.totalToolCallCount}`,
    '',
    'Use the context already present in the conversation and the evidence parts injected by the harness.',
    '',
    'Focus on the session-level qualitative outcome and avoid inventing counts or arrays in the response.',
    '',
    'Evaluation focus:',
    buildAnalysisFocusInstructions(params.analysisTarget),
    '',
    'Output requirements:',
    '- Return one JSON object only.',
    '- Support the outcome, rationale, and summaries with evidence from the analysis.',
    '- Array fields must not contain null values.',
    '',
    'Output schema:',
    JSON.stringify({
      overall_tool_use_outcome: 'string',
      overall_rationale: 'string',
      tool_summaries: [{}],
      repeated_failure_patterns: [],
      follow_up_candidates: [],
    }, null, 2),
  ]

  return sections.join('\n')
}
