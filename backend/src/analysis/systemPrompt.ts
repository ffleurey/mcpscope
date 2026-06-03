import type { AnalysisWorkflowKind } from './workflowKinds.js'
import { ANALYSIS_WORKFLOW_KIND } from './workflowKinds.js'
import { buildFullSessionSystemPrompt, normalizeAnalysisGoal as normalizeFullSessionAnalysisGoal } from './fullSession/systemPrompt.js'
import { buildFastSessionSystemPrompt } from './fastSession/systemPrompt.js'
import { buildFastToolSystemPrompt } from './fastTool/systemPrompt.js'

export function normalizeAnalysisGoal(analysisGoal?: string): string {
  return normalizeFullSessionAnalysisGoal(analysisGoal)
}

export function buildAnalysisSystemPrompt(input: {
  analysisGoal: string
  additionalInstructions?: string
  workflowKind?: AnalysisWorkflowKind
}): string {
  const extraInstructions = input.additionalInstructions?.trim() ?? ''

  if (input.workflowKind === ANALYSIS_WORKFLOW_KIND.FAST_SESSION) {
    return buildFastSessionSystemPrompt({
      analysisGoal: input.analysisGoal,
      additionalInstructions: extraInstructions,
    })
  }

  if (input.workflowKind === ANALYSIS_WORKFLOW_KIND.FAST_TOOL) {
    return buildFastToolSystemPrompt({
      analysisGoal: input.analysisGoal,
      additionalInstructions: extraInstructions,
    })
  }

  return buildFullSessionSystemPrompt({
    analysisGoal: input.analysisGoal,
    additionalInstructions: extraInstructions,
  })
}