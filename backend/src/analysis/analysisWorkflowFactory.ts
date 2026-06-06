import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { getSessionRecord } from '../persistence/repository.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { FullSessionAnalysis } from './fullSession/fullSessionAnalysis.js'
import { FastSessionAnalysis } from './fastSession/fastSessionAnalysis.js'
import { FastToolAnalysis } from './fastTool/fastToolAnalysis.js'
import { ANALYSIS_WORKFLOW_KIND } from './workflowKinds.js'
import type { AnalysisSessionState } from './schemas.js'

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
  const session = getSessionRecord(database.connection, analysisSessionId)
  if (!session || !session.analysisState) return null

  const workflowKind = (session.analysisState as unknown as AnalysisSessionState)?.workflow_kind
    ?? ANALYSIS_WORKFLOW_KIND.FULL_SESSION

  switch (workflowKind) {
    case ANALYSIS_WORKFLOW_KIND.FULL_SESSION:
      return FullSessionAnalysis.rehydrate(database, lmGateway, mcpGateway, analysisSessionId)
    case ANALYSIS_WORKFLOW_KIND.FAST_SESSION:
      return FastSessionAnalysis.rehydrate(database, lmGateway, mcpGateway, analysisSessionId)
    case ANALYSIS_WORKFLOW_KIND.FAST_TOOL:
      return FastToolAnalysis.rehydrate(database, lmGateway, mcpGateway, analysisSessionId)
    default:
      throw new Error(`Unsupported analysis workflow kind: ${workflowKind}`)
  }
}