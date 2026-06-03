import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { listStepRecordsBySession } from '../persistence/repositoryV2.js'
import type { AnalysisSessionState } from './schemas.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { AnalysisWorkflowRuntime } from './analysisWorkflowRuntime.js'
import {
  advanceFastToolAnalysisStep,
  createFastToolAnalysisState,
  getFastToolAnalysisCursorParams,
  isFastToolAnalysisTerminal,
  type FastToolAnalysisWorkflowInput,
} from './fastTool/fastToolAnalysisWorkflow.js'
import { ANALYSIS_CURSOR_STEP_TYPE } from './analysisSession.js'

export class FastToolAnalysisSession {
  private readonly database: BackendDatabase
  private readonly lmGateway: LmStudioGateway
  private readonly mcpGateway: McpGateway
  private readonly runtime: AnalysisWorkflowRuntime<AnalysisSessionState>
  private state: AnalysisSessionState
  private cursorStepId: string

  constructor(
    database: BackendDatabase,
    lmGateway: LmStudioGateway,
    mcpGateway: McpGateway,
    input: FastToolAnalysisWorkflowInput,
  ) {
    this.database = database
    this.lmGateway = lmGateway
    this.mcpGateway = mcpGateway
    this.cursorStepId = ''
    this.state = createFastToolAnalysisState(input)

    this.runtime = new AnalysisWorkflowRuntime(this.database, {
      cursorStepType: ANALYSIS_CURSOR_STEP_TYPE,
      getState: () => this.state,
      setState: (state) => { this.state = state },
      getCursorStepId: () => this.cursorStepId,
      setCursorStepId: (cursorStepId) => { this.cursorStepId = cursorStepId },
      getCursorParams: getFastToolAnalysisCursorParams,
      getCursorStatus: (state) => state.phase === 'complete'
        ? 'complete'
        : state.phase === 'error'
          ? 'error'
          : 'running',
      isTerminal: isFastToolAnalysisTerminal,
      advance: (emitEvent) => this.advance(emitEvent),
    })
  }

  initializeCursorStep(): void {
    this.runtime.initializeCursorStep()
  }

  static rehydrateFromDb(
    database: BackendDatabase,
    lmGateway: LmStudioGateway,
    mcpGateway: McpGateway,
    analysisSessionId: string,
  ): FastToolAnalysisSession | null {
    const steps = listStepRecordsBySession(database.connection, analysisSessionId)
    const cursorStep = steps.find(step => step.stepTypeKey === ANALYSIS_CURSOR_STEP_TYPE)
    if (!cursorStep) return null

    const instance = new FastToolAnalysisSession(database, lmGateway, mcpGateway, {
      analysisSessionId,
      targetSessionId: '',
      targetTurnId: '',
      analysisGoal: '',
      selectedToolNames: [],
      onlyFailedToolCalls: false,
      evaluationCriteria: [],
    })
    instance.runtime.restore(cursorStep.id, cursorStep.state as unknown as AnalysisSessionState)
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
    this.state = await advanceFastToolAnalysisStep({
      database: this.database,
      lmGateway: this.lmGateway,
      mcpGateway: this.mcpGateway,
    }, this.state, emitEvent)
  }
}