import type { AnalysisTarget } from '../schemas.js'
import { buildAnalysisFocusInstructions } from '../schemas.js'
import { buildSharedEvaluationPrompt } from '../evaluationPromptShared.js'

export function buildToolCallEvaluationPrompt(params: {
  analysisTarget: AnalysisTarget
  subjectId: string
  turnId: string
  roundId: string
  toolCallPartId: string
  toolName: string
  toolCallParameters: string
}): string {
  return buildSharedEvaluationPrompt({
    title: 'a single tool call in an analysis session',
    subjectScope: 'tool_call',
    subjectId: params.subjectId,
    evaluationFocus: buildAnalysisFocusInstructions(params.analysisTarget),
    contextBlock: [
      'Tool-call metadata:',
      `- turn_id: ${params.turnId}`,
      `- round_id: ${params.roundId}`,
      `- tool_call_part_id: ${params.toolCallPartId}`,
      `- tool_name: ${params.toolName}`,
      `- tool_call_parameters: ${params.toolCallParameters}`,
    ].join('\n'),
  })
}

export function buildTurnSummaryEvaluationPrompt(params: {
  analysisTarget: AnalysisTarget
  subjectId: string
  repeatedTools: string[]
  repeatedAttemptGuidance: string | null
  turnPacketCount: number
}): string {
  return buildSharedEvaluationPrompt({
    title: 'a turn-level analysis summary',
    subjectScope: 'turn',
    subjectId: params.subjectId,
    evaluationFocus: buildAnalysisFocusInstructions(params.analysisTarget),
    contextBlock: [
      'Turn summary context:',
      `- turn_packet_count: ${params.turnPacketCount}`,
      `- repeated_tools: ${params.repeatedTools.length > 0 ? params.repeatedTools.join(', ') : 'none'}`,
      `- repeated_attempt_guidance: ${params.repeatedAttemptGuidance ?? 'none'}`,
    ].join('\n'),
    extraInstructions: 'Focus on the qualitative outcome of the turn, not on generating counts or arrays.',
  })
}

export function buildFinalAggregationEvaluationPrompt(params: {
  analysisTarget: AnalysisTarget
  subjectId: string
  assessmentCount: number
  turnSummaryCount: number
}): string {
  return buildSharedEvaluationPrompt({
    title: 'the overall analysis session outcome',
    subjectScope: 'session',
    subjectId: params.subjectId,
    evaluationFocus: buildAnalysisFocusInstructions(params.analysisTarget),
    contextBlock: [
      'Session aggregation context:',
      `- assessment_count: ${params.assessmentCount}`,
      `- turn_summary_count: ${params.turnSummaryCount}`,
    ].join('\n'),
    extraInstructions: 'Focus on the session-level qualitative outcome and avoid inventing counts or arrays in the response.',
  })
}
