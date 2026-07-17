import {
  getSessionRecord,
  listTurnRecordsBySession,
  updateTurnRecord,
} from '../persistence/repository.js'
import { ChatSession } from './chatSession.js'
import { runSessionInitialization } from './sessionInit.js'
import type { TurnRecord } from '../domain/model.js'
import type {
  ActiveExecutionJob,
  SchedulerContext,
  SchedulerExecutionEvent,
} from './schedulerTypes.js'

/**
 * Session-executor registry — the engine-side hook that lets the workbench
 * teach the scheduler how to execute concrete session types without the
 * engine importing any analysis code. Mirrors the session-presenter registry
 * in `operations/sessionPresentation.ts`.
 *
 * The engine registers the `primary` executor itself (below). The workbench
 * registers the analysis executor at startup (see
 * `registerAnalysisSessionExecutor()` in `analysis/analysisSessionExecutor.ts`,
 * called from `buildBackendApp`).
 */

export interface SessionExecutionOptions {
  emitExecutionEvent: (event: SchedulerExecutionEvent) => void
  shouldPauseAtBoundary: () => boolean
}

export interface SessionExecutor {
  /** Session type this executor handles (e.g. 'primary', 'session_analysis'). */
  readonly sessionType: string
  /** Execute a `session`-kind job (a full run for this session type). */
  executeSession(
    job: ActiveExecutionJob,
    opCtx: SchedulerContext,
    options: SessionExecutionOptions,
  ): Promise<void>
  /** Execute a `step`-kind job (single-step advance), for session types that support it. */
  executeStep?(
    job: ActiveExecutionJob,
    opCtx: SchedulerContext,
    options: SessionExecutionOptions,
  ): Promise<void>
}

const executorRegistry = new Map<string, SessionExecutor>()

export function registerSessionExecutor(executor: SessionExecutor): void {
  executorRegistry.set(executor.sessionType, executor)
}

export async function dispatchSchedulerJob(
  job: ActiveExecutionJob,
  opCtx: SchedulerContext,
  options: SessionExecutionOptions,
): Promise<void> {
  const { target } = job
  const session = getSessionRecord(opCtx.db.connection, target.sessionId)
  if (!session) {
    throw new Error(`Session ${target.sessionId} not found at execution time`)
  }

  if (target.kind === 'init') {
    await executeInitJob(job, opCtx, options.emitExecutionEvent)
    return
  }

  const executor = executorRegistry.get(session.sessionType)
  if (!executor) {
    throw new Error(`Unsupported session type: ${session.sessionType}`)
  }

  if (target.kind === 'step') {
    if (!executor.executeStep) {
      throw new Error(`Session type ${session.sessionType} does not support step execution`)
    }
    await executor.executeStep(job, opCtx, options)
    return
  }

  await executor.executeSession(job, opCtx, options)
}

async function executeInitJob(
  job: ActiveExecutionJob,
  opCtx: SchedulerContext,
  emitExecutionEvent: (event: SchedulerExecutionEvent) => void,
): Promise<void> {
  await runSessionInitialization(opCtx.db, opCtx.chatCompletionGateway, opCtx.mcpGateway, job.target.sessionId, emitExecutionEvent)
}

async function executePrimaryJob(
  job: ActiveExecutionJob,
  opCtx: SchedulerContext,
  options: SessionExecutionOptions,
): Promise<void> {
  const prompt = job.prompt
  if (!prompt) {
    throw new Error('Primary session job is missing prompt')
  }

  const session = getSessionRecord(opCtx.db.connection, job.target.sessionId)
  if (!session) throw new Error(`Session ${job.target.sessionId} not found`)

  const turns = listTurnRecordsBySession(opCtx.db.connection, job.target.sessionId)
  const draftTurn = turns.find(t => t.status === 'draft')
  if (!draftTurn) {
    throw new Error(`No draft turn found for session ${job.target.sessionId}`)
  }

  const activeTurn: TurnRecord = { ...draftTurn, status: 'streaming' }
  updateTurnRecord(opCtx.db.connection, activeTurn)

  const chatSession = new ChatSession(
    session,
    opCtx.db,
    opCtx.chatCompletionGateway,
    session.mcpProfileSnapshots.length > 0 ? opCtx.mcpGateway : null,
    activeTurn,
    prompt,
    options.emitExecutionEvent,
  )

  await chatSession.execute()
}

// The engine's own default executor. Registered here, in the module that owns
// the registry — same-module registration, no cross-layer import-order
// dependency.
registerSessionExecutor({
  sessionType: 'primary',
  executeSession: executePrimaryJob,
})
