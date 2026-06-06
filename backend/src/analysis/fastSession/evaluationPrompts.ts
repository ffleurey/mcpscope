import type { AnalysisTarget } from '../schemas.js'
import { buildAnalysisFocusInstructions } from '../schemas.js'
import { buildSharedEvaluationPrompt } from '../evaluationPromptShared.js'

export function buildFastSessionToolCallAssessmentPrompt(params: {
  analysisTarget: AnalysisTarget
  subjectId: string
  turnId: string
  roundId: string
  toolCallPartId: string
  toolName: string
  toolCallParameters: string
  preReasoningPartId: string | null
  postReasoningPartId: string | null
}): string {
  return buildSharedEvaluationPrompt({
    title: 'a tool call in a fast analysis session',
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
      `- pre_reasoning_part_id: ${params.preReasoningPartId ?? 'null'}`,
      `- post_reasoning_part_id: ${params.postReasoningPartId ?? 'null'}`,
    ].join('\n'),
    extraInstructions: 'Focus on the qualitative execution of the tool call and the clarity of the underlying tool contract.',
  })
}

export function buildFastSessionTurnSummaryPrompt(params: {
  analysisTarget: AnalysisTarget
  subjectId: string
  currentTurnId: string
  turnPacketCount: number
  repeatedTools: string
}): string {
  return buildSharedEvaluationPrompt({
    title: 'a turn-level summary in a fast analysis session',
    subjectScope: 'turn',
    subjectId: params.subjectId,
    evaluationFocus: buildAnalysisFocusInstructions(params.analysisTarget),
    contextBlock: [
      'Turn summary context:',
      `- current_turn_id: ${params.currentTurnId}`,
      `- turn_packet_count: ${params.turnPacketCount}`,
      `- repeated_tools: ${params.repeatedTools}`,
    ].join('\n'),
    extraInstructions: 'Focus on the turn-level qualitative outcome and avoid generating arrays in the response.',
  })
}

export function buildFastSessionFinalAggregationPrompt(params: {
  analysisTarget: AnalysisTarget
  assessmentCount: number
  turnSummaryCount: number
}): string {
  const sections = [
    'You are evaluating the overall fast-session analysis outcome.',
    '',
    'Session aggregation context:',
    `- assessment_count: ${params.assessmentCount}`,
    `- turn_summary_count: ${params.turnSummaryCount}`,
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
      overall_outcome: 'string',
      overall_rationale: 'string',
      path_efficiency: 'efficient|mixed|inefficient|unclear',
      tool_summaries: [{}],
      notable_failures: [],
      follow_up_candidates: [],
    }, null, 2),
  ]

  return sections.join('\n')
}
