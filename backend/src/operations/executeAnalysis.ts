/**
 * executeAnalysis — internal helpers used by the scheduler's analysis dispatch.
 *
 * The public execution path for analysis sessions goes through the scheduler
 * (POST /api/sessions/:id/execute enqueues via scheduler.enqueueSession or
 * scheduler.enqueueStep). The functions below are kept as internal reference
 * only; the canonical flow runs through scheduler.executeAnalysisJob and
 * scheduler.executeAnalysisOneStepJob.
 *
 * @deprecated Use the scheduler execution path instead of calling these
 * directly. These exports remain for test-harness use only and may be removed
 * in a future cleanup pass.
 */

import { OperationError } from './errors.js'
import {
  findActiveSession,
  getSessionRecord,
  listTurnRecordsBySession,
  listRoundRecordsBySession,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  updateSessionRecord,
  listStepRecordsBySession,
} from '../persistence/repository.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import { deriveTranscriptEntries, deriveContextEntries } from '../domain/selectors.js'
import { AnalysisSession } from '../analysis/analysisSession.js'
import { listArtifactsBySession } from '../analysis/artifactRepository.js'
import type { OperationContext } from './context.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'

export async function streamAnalysisWorkflow(
  ctx: OperationContext,
  analysisSessionId: string,
  emitEvent: AnalysisStreamEventSink,
  options: { singleStep?: boolean } = {},
): Promise<void> {
  try {
    await executeAnalysisWorkflow(ctx, analysisSessionId, emitEvent, options)
  } catch (error) {
    ctx.logger?.error(
      { sessionId: analysisSessionId, err: error instanceof Error ? error.message : String(error) },
      'Analysis execution failed',
    )
    emitEvent({
      type: 'analysis-failed',
      message: error instanceof Error ? error.message : 'Unknown execution failure',
    })
  }
}

export async function executeAnalysisWorkflow(
  ctx: OperationContext,
  analysisSessionId: string,
  emitEvent: AnalysisStreamEventSink,
  options: { singleStep?: boolean } = {},
): Promise<void> {
  const { db } = ctx

  // ── Validate session ───────────────────────────────────────────────────────
  const session = getSessionRecord(db.connection, analysisSessionId)
  if (!session) {
    throw new OperationError('Analysis session not found.', 'not_found')
  }
  if (session.sessionType !== 'session_analysis') {
    throw new OperationError(
      'Session is not an analysis session.',
      'not_analysis_session',
    )
  }
  if (session.initStatus !== 'ready') {
    throw new OperationError(
      `Analysis session is not ready to execute (initStatus = '${session.initStatus}').`,
      'not_ready',
    )
  }

  // ── Check cursor step phase ───────────────────────────────────────────────
  const steps = listStepRecordsBySession(db.connection, analysisSessionId)
  const cursorStep = steps.find(s => s.stepTypeKey === 'analysis_v2_cursor')
  if (!cursorStep) {
    throw new OperationError(
      'Analysis session has no cursor step — it may not have been initialized correctly.',
      'not_ready',
    )
  }
  const phase = (cursorStep.state as { phase?: string }).phase
  if (phase === 'complete') {
    throw new OperationError(
      'Analysis workflow is already complete.',
      'analysis_already_complete',
    )
  }

  // ── Enforce global session lock ────────────────────────────────────────────
  const active = findActiveSession(db.connection)
  if (active && active.id !== analysisSessionId) {
    throw new OperationError(
      'Another session is currently active. Nothing was started.',
      'another_session_active',
      { id: active.id, state: active.state },
    )
  }
  // ── Mark session active ───────────────────────────────────────────────────
  session.status = 'active'
  session.updatedAt = Date.now()
  updateSessionRecord(db.connection, session)

  // ── Run the analysis workflow ─────────────────────────────────────────────
  try {
    const instance = AnalysisSession.rehydrateFromDb(db, ctx.lmStudioGateway, ctx.mcpGateway, analysisSessionId)
    if (!instance) {
      throw new Error('Failed to rehydrate analysis session from cursor step')
    }
    if (options.singleStep) {
      await instance.resumeOneStep(emitEvent)
    } else {
      await instance.resume(emitEvent)
    }
  } finally {
    // ── Mark session ready (or error) ────────────────────────────────────────
    const finalSession = getSessionRecord(db.connection, analysisSessionId) ?? session
    if (finalSession.status === 'active') {
      finalSession.status = 'ready'
      finalSession.updatedAt = Date.now()
      updateSessionRecord(db.connection, finalSession)
    }
  }

  // ── Emit final trace ──────────────────────────────────────────────────────
  const finalSession = getSessionRecord(db.connection, analysisSessionId)!
  const finalParts = listPartRecordsBySession(db.connection, analysisSessionId)
  const trace = buildSessionTraceBundle({
    session: finalSession,
    steps: listStepRecordsBySession(db.connection, analysisSessionId),
    turns: listTurnRecordsBySession(db.connection, analysisSessionId),
    rounds: listRoundRecordsBySession(db.connection, analysisSessionId),
    parts: finalParts,
    rawExchanges: listRawExchangeRecordsBySession(db.connection, analysisSessionId),
    artifacts: listArtifactsBySession(db.connection, analysisSessionId),
    transcript: deriveTranscriptEntries(finalParts),
    context: deriveContextEntries(finalParts),
  })

  emitEvent({ type: 'analysis-complete', trace })
}
