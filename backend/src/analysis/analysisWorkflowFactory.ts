import { listStepRecordsBySession } from '../persistence/repositoryV2.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { AnalysisSession, ANALYSIS_CURSOR_STEP_TYPE } from './analysisSession.js'
import { FastSessionAnalysisSession } from './fastSessionAnalysisSession.js'
import { FastToolAnalysisSession } from './fastToolAnalysisSession.js'
import { ANALYSIS_WORKFLOW_KIND, type AnalysisWorkflowKind } from './workflowKinds.js'

export interface RehydratableAnalysisWorkflow {
  canContinue(): boolean
  resume(emitEvent?: AnalysisStreamEventSink): Promise<void>
  resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void>
}

export function rehydrateAnalysisWorkflow(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  analysisSessionId: string,
): RehydratableAnalysisWorkflow | null {
  const steps = listStepRecordsBySession(database.connection, analysisSessionId)
  const cursorStep = steps.find(step => step.stepTypeKey === ANALYSIS_CURSOR_STEP_TYPE)
  if (!cursorStep) return null

  const workflowKind = (cursorStep.params as { workflow_kind?: AnalysisWorkflowKind } | null)?.workflow_kind
    ?? ANALYSIS_WORKFLOW_KIND.FULL_SESSION

  switch (workflowKind) {
    case ANALYSIS_WORKFLOW_KIND.FULL_SESSION:
      return AnalysisSession.rehydrateFromDb(database, lmGateway, mcpGateway, analysisSessionId)
    case ANALYSIS_WORKFLOW_KIND.FAST_SESSION:
      return FastSessionAnalysisSession.rehydrateFromDb(database, lmGateway, mcpGateway, analysisSessionId)
    case ANALYSIS_WORKFLOW_KIND.FAST_TOOL:
      return FastToolAnalysisSession.rehydrateFromDb(database, lmGateway, mcpGateway, analysisSessionId)
    default:
      throw new Error(`Unsupported analysis workflow kind: ${workflowKind}`)
  }
}