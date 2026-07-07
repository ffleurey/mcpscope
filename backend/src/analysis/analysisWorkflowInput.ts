import type { RubricCriterion } from '../domain/model.js'

export interface AnalysisWorkflowInput {
  analysisSessionId: string
  targetSessionId: string
  targetTurnId: string
  analysisGoal: string
  selectedToolNames: string[]
  onlyFailedToolCalls: boolean
  evaluationCriteria: string[]
  /** Scored rubric for the benchmark_evaluation judge (optional). */
  rubric?: RubricCriterion[]
}
