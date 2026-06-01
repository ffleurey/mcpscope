import {
  insertStepRecord,
  updateStepRecord,
} from '../persistence/repositoryV2.js'
import { stepTypeKey as mkStepTypeKey } from '../domain/executionModel.js'
import { formatStepId } from '../domain/hierarchicalIds.js'
import { getNextStepOrdinal } from '../persistence/repositoryV2.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { StepPersistenceRecord } from '../domain/persistenceContract.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'

function now(): number {
  return Date.now()
}

interface AnalysisWorkflowRuntimeOptions<State extends { analysisSessionId: string }> {
  cursorStepType: string
  getState: () => State
  setState: (state: State) => void
  getCursorStepId: () => string
  setCursorStepId: (cursorStepId: string) => void
  getCursorParams: (state: State) => Record<string, unknown>
  getCursorStatus: (state: State) => StepPersistenceRecord['status']
  isTerminal: (state: State) => boolean
  advance: (emitEvent?: AnalysisStreamEventSink) => Promise<void>
}

export class AnalysisWorkflowRuntime<State extends { analysisSessionId: string }> {
  private readonly database: BackendDatabase
  private readonly options: AnalysisWorkflowRuntimeOptions<State>

  constructor(
    database: BackendDatabase,
    options: AnalysisWorkflowRuntimeOptions<State>,
  ) {
    this.database = database
    this.options = options
  }

  initializeCursorStep(): void {
    const state = this.options.getState()
    const ordinal = getNextStepOrdinal(this.database.connection, state.analysisSessionId)
    const cursorStepId = formatStepId(state.analysisSessionId, ordinal)
    this.options.setCursorStepId(cursorStepId)

    insertStepRecord(this.database.connection, {
      id: cursorStepId,
      sessionId: state.analysisSessionId,
      stepTypeKey: mkStepTypeKey(this.options.cursorStepType),
      ordinal,
      status: 'running',
      params: this.options.getCursorParams(state),
      state: state as unknown as Record<string, unknown>,
      createdAt: now(),
      completedAt: null,
    })
  }

  restore(cursorStepId: string, state: State): void {
    this.options.setCursorStepId(cursorStepId)
    this.options.setState(state)
  }

  canContinue(): boolean {
    return !this.options.isTerminal(this.options.getState())
  }

  async execute(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    if (!this.options.getCursorStepId()) {
      this.initializeCursorStep()
    }
    await this.runLoop(emitEvent)
  }

  async resume(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    await this.runLoop(emitEvent)
  }

  async resumeOneStep(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    if (!this.canContinue()) return
    await this.options.advance(emitEvent)
    this.persistState()
  }

  private async runLoop(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    const MAX_ITERATIONS = 1000
    let iterations = 0

    while (this.canContinue()) {
      if (iterations++ > MAX_ITERATIONS) {
        const state = this.options.getState() as State & { phase?: string }
        this.options.setState({
          ...state,
          phase: 'error',
        } as State)
        this.persistState()
        throw new Error('Analysis workflow runtime: exceeded maximum iteration limit')
      }

      await this.options.advance(emitEvent)
      this.persistState()
    }
  }

  private persistState(): void {
    const state = this.options.getState()
    const cursorStepId = this.options.getCursorStepId()
    if (!cursorStepId) {
      throw new Error('Cannot persist analysis workflow state without a cursor step id')
    }

    updateStepRecord(this.database.connection, {
      id: cursorStepId,
      sessionId: state.analysisSessionId,
      stepTypeKey: mkStepTypeKey(this.options.cursorStepType),
      ordinal: 0,
      status: this.options.getCursorStatus(state),
      params: this.options.getCursorParams(state),
      state: state as unknown as Record<string, unknown>,
      createdAt: now(),
      completedAt: this.options.isTerminal(state) ? now() : null,
    })
  }
}