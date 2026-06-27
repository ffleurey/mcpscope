import {
  getSessionRecord,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  listRoundRecordsBySession,
  listStepRecordsBySession,
  listTurnRecordsBySession,
  updateSessionRecord,
  updateTurnRecord,
} from '../persistence/repository.js'
import { listArtifactsBySession } from '../analysis/artifactRepository.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import { deriveContextEntries, deriveTranscriptEntries } from '../domain/selectors.js'
import { ChatSession } from './chatSession.js'
import { rehydrateAnalysisWorkflow } from '../analysis/analysisWorkflowFactory.js'
import { runSessionInitialization } from './sessionInit.js'
import type { TurnRecord } from '../domain/model.js'
import type {
  ActiveExecutionJob,
  SchedulerContext,
} from './schedulerTypes.js'
import type { PreludeStreamEvent } from './sessionInit.js'
import type { AnalysisStreamEvent, TurnStreamEvent } from './streamEvents.js'

export async function dispatchSchedulerJob(
  job: ActiveExecutionJob,
  opCtx: SchedulerContext,
  options: {
    emitExecutionEvent: (event: TurnStreamEvent | AnalysisStreamEvent | PreludeStreamEvent) => void
    shouldPauseAtBoundary: () => boolean
  },
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
  if (target.kind === 'step') {
    await executeAnalysisOneStepJob(job, opCtx, options.emitExecutionEvent as (event: TurnStreamEvent | AnalysisStreamEvent) => void)
    return
  }
  if (session.sessionType === 'primary') {
    await executePrimaryJob(job, opCtx, options.emitExecutionEvent as (event: TurnStreamEvent) => void)
    return
  }
  if (session.sessionType === 'session_analysis') {
    await executeAnalysisJob(job, opCtx, options)
    return
  }

  throw new Error(`Unsupported session type: ${session.sessionType}`)
}

async function executeInitJob(
  job: ActiveExecutionJob,
  opCtx: SchedulerContext,
  emitExecutionEvent: (event: PreludeStreamEvent) => void,
): Promise<void> {
  await runSessionInitialization(opCtx.db, opCtx.chatCompletionGateway, opCtx.mcpGateway, job.target.sessionId, emitExecutionEvent)
}

async function executePrimaryJob(
  job: ActiveExecutionJob,
  opCtx: SchedulerContext,
  emitExecutionEvent: (event: TurnStreamEvent) => void,
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
    emitExecutionEvent,
  )

  await chatSession.execute()
}

async function executeAnalysisJob(
  job: ActiveExecutionJob,
  opCtx: SchedulerContext,
  options: {
    emitExecutionEvent: (event: TurnStreamEvent | AnalysisStreamEvent) => void
    shouldPauseAtBoundary: () => boolean
  },
): Promise<void> {
  const session = getSessionRecord(opCtx.db.connection, job.target.sessionId)
  if (!session) throw new Error(`Session ${job.target.sessionId} not found at analysis execution time`)

  session.status = 'active'
  session.updatedAt = Date.now()
  updateSessionRecord(opCtx.db.connection, session)

  try {
    const instance = rehydrateAnalysisWorkflow(opCtx.db, opCtx.chatCompletionGateway, opCtx.mcpGateway, job.target.sessionId)
    if (!instance) {
      throw new Error('Failed to rehydrate analysis session')
    }

    while (instance.canContinue()) {
      await instance.resumeOneStep(options.emitExecutionEvent)
      if (options.shouldPauseAtBoundary()) {
        break
      }
    }
  } finally {
    const finalSession = getSessionRecord(opCtx.db.connection, job.target.sessionId) ?? session
    if (finalSession.status === 'active') {
      finalSession.status = 'ready'
      finalSession.updatedAt = Date.now()
      updateSessionRecord(opCtx.db.connection, finalSession)
    }
  }

  const finalSession = getSessionRecord(opCtx.db.connection, job.target.sessionId)
  const analysisState = finalSession?.analysisState as { phase?: string } | null
  const phase = analysisState?.phase ?? null
  if (phase === 'complete' || phase === 'error') {
    const trace = buildAnalysisTrace(opCtx, job.target.sessionId)
    options.emitExecutionEvent({ type: 'analysis-complete', trace })
  }
}

async function executeAnalysisOneStepJob(
  job: ActiveExecutionJob,
  opCtx: SchedulerContext,
  emitExecutionEvent: (event: TurnStreamEvent | AnalysisStreamEvent) => void,
): Promise<void> {
  const session = getSessionRecord(opCtx.db.connection, job.target.sessionId)
  if (!session) throw new Error(`Session ${job.target.sessionId} not found at one-step execution time`)

  session.status = 'active'
  session.updatedAt = Date.now()
  updateSessionRecord(opCtx.db.connection, session)

  try {
    const instance = rehydrateAnalysisWorkflow(opCtx.db, opCtx.chatCompletionGateway, opCtx.mcpGateway, job.target.sessionId)
    if (!instance) {
      throw new Error('Failed to rehydrate analysis session')
    }
    await instance.resumeOneStep(emitExecutionEvent)
  } finally {
    const finalSession = getSessionRecord(opCtx.db.connection, job.target.sessionId) ?? session
    if (finalSession.status === 'active') {
      finalSession.status = 'ready'
      finalSession.updatedAt = Date.now()
      updateSessionRecord(opCtx.db.connection, finalSession)
    }
  }

  const finalSession = getSessionRecord(opCtx.db.connection, job.target.sessionId)
  const analysisState = finalSession?.analysisState as { phase?: string } | null
  const phase = analysisState?.phase ?? null
  if (phase === 'complete' || phase === 'error') {
    const trace = buildAnalysisTrace(opCtx, job.target.sessionId)
    emitExecutionEvent({ type: 'analysis-complete', trace })
  }
}

function buildAnalysisTrace(opCtx: SchedulerContext, sessionId: string) {
  const session = getSessionRecord(opCtx.db.connection, sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found while building analysis trace`)
  }
  const parts = listPartRecordsBySession(opCtx.db.connection, sessionId)
  return buildSessionTraceBundle({
    session,
    steps: listStepRecordsBySession(opCtx.db.connection, sessionId),
    turns: listTurnRecordsBySession(opCtx.db.connection, sessionId),
    rounds: listRoundRecordsBySession(opCtx.db.connection, sessionId),
    parts,
    rawExchanges: listRawExchangeRecordsBySession(opCtx.db.connection, sessionId),
    artifacts: listArtifactsBySession(opCtx.db.connection, sessionId),
    transcript: deriveTranscriptEntries(parts),
    context: deriveContextEntries(parts),
  })
}