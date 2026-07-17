import {
  getSessionRecord,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  listRoundRecordsBySession,
  listStepRecordsBySession,
  listTurnRecordsBySession,
  updateSessionRecord,
} from 'mcpscope-engine/persistence/repository.js'
import { buildSessionTraceBundle } from 'mcpscope-engine/domain/trace.js'
import { deriveContextEntries, deriveTranscriptEntries } from 'mcpscope-engine/domain/selectors.js'
import { listArtifactsBySession } from './artifactRepository.js'
import { rehydrateAnalysisWorkflow } from './analysisWorkflowFactory.js'
import {
  registerSessionExecutor,
  type SessionExecutionOptions,
} from 'mcpscope-engine/runtime/schedulerDispatch.js'
import type { ActiveExecutionJob, SchedulerContext } from 'mcpscope-engine/runtime/schedulerTypes.js'

/**
 * Register the analysis session executor in the engine's session-executor
 * registry so the scheduler can execute and rehydrate `session_analysis`
 * jobs (full runs and single-step advances) without the engine importing
 * analysis code. Called by the workbench at startup (`buildBackendApp`),
 * mirroring `registerAnalysisSessionPresenter()`.
 */
export function registerAnalysisSessionExecutor(): void {
  registerSessionExecutor({
    sessionType: 'session_analysis',
    executeSession: executeAnalysisJob,
    executeStep: executeAnalysisOneStepJob,
  })
}

async function executeAnalysisJob(
  job: ActiveExecutionJob,
  opCtx: SchedulerContext,
  options: SessionExecutionOptions,
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
  options: SessionExecutionOptions,
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
    await instance.resumeOneStep(options.emitExecutionEvent)
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
