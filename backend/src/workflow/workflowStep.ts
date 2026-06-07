import type { BackendDatabase } from '../persistence/db.js'
import type { ChatCompletionGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { insertStepRecord, getNextChildIndex, updateStepRecord } from '../persistence/repositoryV2.js'
import { formatStepId } from '../domain/hierarchicalIds.js'
import type { StepPersistenceRecord } from '../domain/persistenceContract.js'
import type { StepContext } from './stepContext.js'
import type { StepResult, StepTypeKey } from '../domain/executionModel.js'

function now(): number { return Date.now() }

// ── AnalysisCommand — a single unit of work in the execution plan ──────────

export interface AnalysisCommand {
  /** Human-readable kind, e.g. 'bootstrap', 'assess', 'turn_summary'. */
  readonly kind: string
  /** Semantic identity within the plan, e.g. a tool_call_part_id or turn_id. */
  readonly semanticId: string
  /** StepTypeKey for the WorkflowStep that executes this command. */
  readonly stepTypeKey: StepTypeKey

  /** True when this command's output already exists in the DB. */
  isComplete(db: BackendDatabase, sessionId: string): boolean
}

// ── WorkflowStep — base class for step execution ───────────────────────────

export abstract class WorkflowStep implements AnalysisCommand {
  stepId: string = ''
  status: string = 'pending'

  protected readonly db: BackendDatabase
  protected readonly lm: ChatCompletionGateway
  protected readonly mcp: McpGateway

  abstract readonly kind: string
  abstract readonly stepTypeKey: StepTypeKey
  abstract get stepLabel(): string
  abstract get semanticId(): string
  abstract isComplete(db: BackendDatabase, sessionId: string): boolean

  constructor(
    db: BackendDatabase,
    lm: ChatCompletionGateway,
    mcp: McpGateway,
  ) {
    this.db = db
    this.lm = lm
    this.mcp = mcp
  }

  async execute(ctx: StepContext): Promise<StepResult> {
    const childIndex = getNextChildIndex(this.db.connection, ctx.sessionId)
    this.stepId = formatStepId(ctx.sessionId, childIndex)

    const record: StepPersistenceRecord = {
      id: this.stepId,
      sessionId: ctx.sessionId,
      stepTypeKey: ctx.stepTypeKey,
      parentStepId: null,
      childIndex,
      status: 'running',
      params: {},
      state: {},
      createdAt: now(),
      completedAt: null,
    }

    insertStepRecord(this.db.connection, record)
    ctx.emitSink?.({ type: 'analysis-step-started', step: record })

    try {
      const result = await this.run(ctx)

      const completed: StepPersistenceRecord = {
        ...record,
        status: result.status === 'error' ? 'error' : 'complete',
        state: result.status === 'complete' ? record.state : { error: result.error },
        completedAt: now(),
      }
      updateStepRecord(this.db.connection, completed)
      ctx.emitSink?.({ type: 'analysis-step-completed', step: completed })

      this.status = result.status
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed: StepPersistenceRecord = {
        ...record,
        status: 'error',
        state: { error: message },
        completedAt: now(),
      }
      updateStepRecord(this.db.connection, failed)
      ctx.emitSink?.({ type: 'analysis-step-completed', step: failed })

      this.status = 'error'
      return { status: 'error', outputArtifacts: [], error: message }
    }
  }

  protected abstract run(ctx: StepContext): Promise<StepResult>
}
