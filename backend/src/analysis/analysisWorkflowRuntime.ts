import { updateSessionAnalysisState } from '../persistence/repository.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'

interface AnalysisWorkflowRuntimeOptions<State extends { analysisSessionId: string }> {
  getState: () => State
  setState: (state: State) => void
  getCursorStatus: (state: State) => string
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

  restore(state: State): void {
    this.options.setState(state)
  }

  canContinue(): boolean {
    return !this.options.isTerminal(this.options.getState())
  }

  async execute(emitEvent?: AnalysisStreamEventSink): Promise<void> {
    this.persistState()
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
    updateSessionAnalysisState(
      this.database.connection,
      state.analysisSessionId,
      state as unknown as Record<string, unknown>,
    )
  }
}
