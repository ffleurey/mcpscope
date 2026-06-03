export interface AnalysisWorkflowInput {
  analysisSessionId: string
  targetSessionId: string
  targetTurnId: string
  analysisGoal: string
  selectedToolNames: string[]
  onlyFailedToolCalls: boolean
  evaluationCriteria: string[]
}
