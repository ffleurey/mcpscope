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
  subjectId: string
  assessmentCount: number
  totalToolCallCount: number
}): string {
  return buildSharedEvaluationPrompt({
    title: 'the overall fast-tool analysis outcome',
    subjectScope: 'session',
    subjectId: params.subjectId,
    evaluationFocus: buildAnalysisFocusInstructions(params.analysisTarget),
    contextBlock: [
      'Fast-tool aggregation context:',
      `- assessment_count: ${params.assessmentCount}`,
      `- total_tool_call_count: ${params.totalToolCallCount}`,
    ].join('\n'),
    extraInstructions: 'Focus on the session-level qualitative outcome and avoid inventing counts or arrays in the response.',
  })
}
