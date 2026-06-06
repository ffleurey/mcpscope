import { normalizeAnalysisGoal as normalizeFullSessionAnalysisGoal } from './fullSession/systemPrompt.js'
import { buildAnalysisSystemPrompt as buildFromFactory } from './analysisWorkflowFactory.js'

export function normalizeAnalysisGoal(analysisGoal?: string): string {
  return normalizeFullSessionAnalysisGoal(analysisGoal)
}

export function buildAnalysisSystemPrompt(input: {
  analysisGoal: string
  additionalInstructions?: string
  workflowKind?: string
}): string {
  return buildFromFactory(input.workflowKind ?? 'full_session_analysis', input)
}
