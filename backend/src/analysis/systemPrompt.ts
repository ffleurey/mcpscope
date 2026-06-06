import { buildAnalysisSystemPrompt as buildFromFactory } from './analysisWorkflowFactory.js'

const DEFAULT_ANALYSIS_GOAL = 'Evaluate whether the target session used tools appropriately and answered the user request correctly.'

export function normalizeAnalysisGoal(analysisGoal?: string): string {
  const trimmed = analysisGoal?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : DEFAULT_ANALYSIS_GOAL
}

export function buildAnalysisSystemPrompt(input: {
  analysisGoal: string
  additionalInstructions?: string
  workflowKind?: string
}): string {
  return buildFromFactory(input.workflowKind ?? 'full_session_analysis', input)
}
