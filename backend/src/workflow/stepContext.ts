import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import type { StepTypeKey } from '../domain/executionModel.js'

export interface StepContext {
  sessionId: string
  stepTypeKey: StepTypeKey
  emitSink?: AnalysisStreamEventSink
  /** Mutable workflow state shared between hooks and steps. */
  workflowState?: Record<string, unknown>
}
