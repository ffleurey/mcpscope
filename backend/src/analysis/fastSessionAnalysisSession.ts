import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { getSessionRecord } from '../persistence/repository.js'
import type { AnalysisSessionState } from './schemas.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { AnalysisWorkflowRuntime } from './analysisWorkflowRuntime.js'
import {
  advanceFastSessionAnalysisStep,
  createFastSessionAnalysisState,
  isFastSessionAnalysisTerminal,
  type FastSessionAnalysisWorkflowInput,
} from './fastSession/fastSessionAnalysisWorkflow.js'

export class FastSessionAnalysisSession {
  private readonly database: BackendDatabase
  private readonly lmGateway: LmStudioGateway
  private readonly mcpGateway: McpGateway
  private readonly runtime: AnalysisWorkflowRuntime<AnalysisSessionState>
  private state: AnalysisSessionState

  constructor(
    database: BackendDatabase,
    lmGateway: LmStudioGateway,
    mcpGateway: McpGateway,
    input: FastSessionAnalysisWorkflowInput,
  ) {
    this.database = database
    this.lmGateway = lmGateway
    this.mcpGateway = mcpGateway
    this.state = createFastSessionAnalysisState(input)

    this.runtime = new AnalysisWorkflowRuntime(this.database, {
      getState: () => this.state,
      setState: (state) => { this.state = state },
      getCursorStatus: (state) => state.phase === 'complete'
        ? 'complete'
        : state.phase === 'error'
          ? 'error'
          : 'running',
      isTerminal: isFastSessionAnalysisTerminal,
      advance: (emitEvent) => this.advance(emitEvent),
    })
  }

  static rehydrateFromDb(
    database: BackendDatabase,
    lmGateway: LmStudioGateway,
    mcpGateway: McpGateway,
    analysisSessionId: string,
  ): FastSessionAnalysisSession | null {
    const session = getSessionRecord(database.connection, analysisSessionId)
    if (!session || !session.analysisState) return null

    const instance = new FastSessionAnalysisSession(database, lmGateway, mcpGateway, {
      analysisSessionId,
      targetSessionId: '',
      targetTurnId: '',
      analysisGoal: '',
      selectedToolNames: [],
      onlyFailedToolCalls: false,
      evaluationCriteria: [],
    })
    instance.runtime.restore(session.analysisState as unknown as AnalysisSessionState)
    return instance
  }

  async resume(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    await this.runtime.resume(emitEvent)
  }

  async resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    await this.runtime.resumeOneStep(emitEvent)
  }

  canContinue(): boolean {
    return this.runtime.canContinue()
  }

  private async advance(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    this.state = await advanceFastSessionAnalysisStep({
      database: this.database,
      lmGateway: this.lmGateway,
      mcpGateway: this.mcpGateway,
    }, this.state, emitEvent)
  }
}
