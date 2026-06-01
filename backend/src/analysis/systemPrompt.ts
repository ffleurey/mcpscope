import type { AnalysisWorkflowKind } from './workflowKinds.js'
import { ANALYSIS_WORKFLOW_KIND } from './workflowKinds.js'
import { renderPromptResource } from './promptResources.js'

const DEFAULT_ANALYSIS_GOAL = 'Evaluate whether the target session used tools appropriately and answered the user request correctly.'

export function normalizeAnalysisGoal(analysisGoal?: string): string {
  const trimmed = analysisGoal?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : DEFAULT_ANALYSIS_GOAL
}

export function buildAnalysisSystemPrompt(input: {
  analysisGoal: string
  additionalInstructions?: string
  workflowKind?: AnalysisWorkflowKind
}): string {
  const extraInstructions = input.additionalInstructions?.trim() ?? ''
  const additionalInstructionsBlock = extraInstructions.length > 0
    ? `\n\nAdditional launch instructions:\n${extraInstructions}`
    : ''

  const resourceName = input.workflowKind === ANALYSIS_WORKFLOW_KIND.FAST_SESSION
    ? 'system.fast-session.txt'
    : input.workflowKind === ANALYSIS_WORKFLOW_KIND.FAST_TOOL
      ? 'system.fast-tool.txt'
      : 'system.full.txt'

  return renderPromptResource(resourceName, {
    analysis_goal: input.analysisGoal,
    additional_instructions_block: additionalInstructionsBlock,
  })
}