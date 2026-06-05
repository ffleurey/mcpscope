import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { getSessionRecord } from '../persistence/repository.js'
import type { AnalysisSessionState } from './schemas.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { AnalysisWorkflowRuntime } from './analysisWorkflowRuntime.js'
import type { AnalysisWorkflowInput } from './analysisWorkflowInput.js'
import {
  advanceFullSessionAnalysisStep,
  createFullSessionAnalysisState,
  isFullSessionAnalysisTerminal,
} from './fullSession/fullSessionAnalysisWorkflow.js'

export type AnalysisSessionInput = AnalysisWorkflowInput

export class AnalysisSession {
  private readonly database: BackendDatabase
  private readonly lmGateway: LmStudioGateway
  private readonly mcpGateway: McpGateway
  private readonly runtime: AnalysisWorkflowRuntime<AnalysisSessionState>
  private state: AnalysisSessionState

  constructor(
    database: BackendDatabase,
    lmGateway: LmStudioGateway,
    mcpGateway: McpGateway,
    input: AnalysisSessionInput,
  ) {
    this.database = database
    this.lmGateway = lmGateway
    this.mcpGateway = mcpGateway
    this.state = createFullSessionAnalysisState(input)

    this.runtime = new AnalysisWorkflowRuntime(this.database, {
      getState: () => this.state,
      setState: (state) => { this.state = state },
      getCursorStatus: (state) => state.phase === 'complete'
        ? 'complete'
        : state.phase === 'error'
          ? 'error'
          : 'running',
      isTerminal: isFullSessionAnalysisTerminal,
      advance: (emitEvent) => this.advance(emitEvent),
    })
  }

  static rehydrateFromDb(
    database: BackendDatabase,
    lmGateway: LmStudioGateway,
    mcpGateway: McpGateway,
    analysisSessionId: string,
  ): AnalysisSession | null {
    const session = getSessionRecord(database.connection, analysisSessionId)
    if (!session || !session.analysisState) return null

    const instance = new AnalysisSession(database, lmGateway, mcpGateway, {
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

  async execute(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    await this.runtime.execute(emitEvent)
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
    this.state = await advanceFullSessionAnalysisStep({
      database: this.database,
      lmGateway: this.lmGateway,
      mcpGateway: this.mcpGateway,
    }, this.state, emitEvent)
  }
}
