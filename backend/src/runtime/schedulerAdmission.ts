import {
  findActiveSession,
  getNextTurnSequenceNumber,
  getSessionRecord,
  insertTurnRecord,
  listStepRecordsBySession,
  listTurnRecordsBySession,
} from '../persistence/repository.js'
import { OperationError } from '../operations/errors.js'
import { formatTurnId } from '../domain/hierarchicalIds.js'
import type { TurnRecord } from '../domain/model.js'
import type { SchedulerContext } from './schedulerTypes.js'
import { SCHEDULER_ERROR } from './schedulerTypes.js'

export function assertInitJobAllowed(
  opCtx: SchedulerContext,
  sessionId: string,
  hasJobForSession: (sessionId: string) => boolean,
): void {
  const session = getSessionRecord(opCtx.db.connection, sessionId)
  if (!session) {
    throw new OperationError('Session not found', SCHEDULER_ERROR.SESSION_NOT_FOUND)
  }
  if (session.sessionType !== 'primary') {
    throw new OperationError('Init jobs are only supported for primary sessions.', 'validation')
  }
  if (session.initStatus === 'ready') {
    throw new OperationError('Session is already initialized.', 'session_already_initialized' as const)
  }
  const active = findActiveSession(opCtx.db.connection, sessionId)
  if (active) {
    throw new OperationError(
      'Another session is currently active. Nothing was started.',
      SCHEDULER_ERROR.SESSION_ACTIVE,
      active,
    )
  }
  if (hasJobForSession(sessionId)) {
    throw new OperationError(
      'This session already has an active or pending job in the scheduler.',
      SCHEDULER_ERROR.SESSION_ALREADY_QUEUED,
    )
  }
}

export function getSessionExecutionKind(
  opCtx: SchedulerContext,
  sessionId: string,
  prompt: string | undefined,
  hasJobForSession: (sessionId: string) => boolean,
): 'primary' | 'analysis' {
  const session = getSessionRecord(opCtx.db.connection, sessionId)
  if (!session) {
    throw new OperationError('Session not found', SCHEDULER_ERROR.SESSION_NOT_FOUND)
  }

  if (session.sessionType === 'primary') {
    if (!prompt || prompt.trim() === '') {
      throw new OperationError('A prompt is required to enqueue a primary session turn.', 'validation')
    }
    const activeFirst = findActiveSession(opCtx.db.connection, sessionId)
    if (activeFirst) {
      throw new OperationError(
        'Another session is currently active. Nothing was queued.',
        SCHEDULER_ERROR.SESSION_ACTIVE,
        activeFirst,
      )
    }
    if (session.initStatus !== 'ready') {
      throw new OperationError(
        `Session is not ready (initStatus = '${session.initStatus}')`,
        SCHEDULER_ERROR.SESSION_NOT_INITIALIZED,
      )
    }
    if (hasJobForSession(sessionId)) {
      throw new OperationError(
        'A turn is already in progress or reserved for this session.',
        SCHEDULER_ERROR.TURN_IN_PROGRESS,
      )
    }
    return 'primary'
  }

  if (session.sessionType === 'session_analysis') {
    if (session.initStatus !== 'ready') {
      throw new OperationError(
        `Session is not ready (initStatus = '${session.initStatus}')`,
        SCHEDULER_ERROR.SESSION_NOT_INITIALIZED,
      )
    }
    if (hasJobForSession(sessionId)) {
      throw new OperationError(
        'This session already has an active or pending job in the scheduler.',
        SCHEDULER_ERROR.SESSION_ALREADY_QUEUED,
      )
    }
    return 'analysis'
  }

  throw new OperationError(`Session type '${session.sessionType}' is not supported by the scheduler.`, 'validation')
}

export function reservePrimaryTurn(opCtx: SchedulerContext, sessionId: string): TurnRecord {
  type ReservationResult =
    | { kind: 'another_session_active'; active: { id: string; state: string } }
    | { kind: 'turn_in_progress' }
    | { kind: 'reserved'; turn: TurnRecord }

  const reservation = opCtx.db.connection.transaction((): ReservationResult => {
    const active = findActiveSession(opCtx.db.connection, sessionId)
    if (active) return { kind: 'another_session_active', active }

    const hasPendingTurn = listTurnRecordsBySession(opCtx.db.connection, sessionId)
      .some(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
    if (hasPendingTurn) return { kind: 'turn_in_progress' }

    const createdAt = Date.now()
    const nextSeq = getNextTurnSequenceNumber(opCtx.db.connection, sessionId)
    const turn: TurnRecord = {
      id: formatTurnId(sessionId, nextSeq),
      sessionId,
      ownerStepId: null,
      sequenceNumber: nextSeq,
      status: 'draft',
      createdAt,
      completedAt: null,
      outcome: null,
      usage: {
        promptTokens: null,
        completionTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      },
      contextTokensAtTurnEnd: null,
      contextTokensAfterCompaction: null,
      compactionApplied: null,
      compactionTokensRemoved: null,
    }
    insertTurnRecord(opCtx.db.connection, turn)
    return { kind: 'reserved', turn }
  })()

  if (reservation.kind === 'another_session_active') {
    throw new OperationError(
      'Another session is currently active. Nothing was queued.',
      SCHEDULER_ERROR.SESSION_ACTIVE,
      reservation.active,
    )
  }
  if (reservation.kind === 'turn_in_progress') {
    throw new OperationError(
      'A turn is already in progress or reserved for this session.',
      SCHEDULER_ERROR.TURN_IN_PROGRESS,
    )
  }

  return reservation.turn
}

export function assertAnalysisSessionJobAllowed(
  opCtx: SchedulerContext,
  sessionId: string,
): void {
  const active = findActiveSession(opCtx.db.connection, sessionId)
  if (active) {
    throw new OperationError(
      'Another session is currently active. Nothing was queued.',
      SCHEDULER_ERROR.SESSION_ACTIVE,
      { id: active.id, state: active.state },
    )
  }
}

export function assertStepJobAllowed(
  opCtx: SchedulerContext,
  sessionId: string,
  stepId: string,
  hasJobForSession: (sessionId: string) => boolean,
): void {
  const session = getSessionRecord(opCtx.db.connection, sessionId)
  if (!session) {
    throw new OperationError('Session not found', SCHEDULER_ERROR.SESSION_NOT_FOUND)
  }
  if (session.sessionType !== 'session_analysis') {
    throw new OperationError('Step execution is only supported for analysis sessions.', SCHEDULER_ERROR.STEP_NOT_READY)
  }
  if (session.initStatus !== 'ready') {
    throw new OperationError(
      `Session is not ready (initStatus = '${session.initStatus}')`,
      SCHEDULER_ERROR.SESSION_NOT_INITIALIZED,
    )
  }

  const steps = listStepRecordsBySession(opCtx.db.connection, sessionId)
  const targetStep = steps.find(s => s.id === stepId)
  if (!targetStep) {
    throw new OperationError(`Step '${stepId}' not found in session '${sessionId}'.`, SCHEDULER_ERROR.STEP_NOT_FOUND)
  }
  if (targetStep.stepTypeKey !== 'analysis_v2_cursor') {
    throw new OperationError(`Step '${stepId}' is not the cursor step for this session.`, SCHEDULER_ERROR.STEP_NOT_READY)
  }
  const phase = (targetStep.state as { phase?: string }).phase
  if (phase === 'complete' || phase === 'error') {
    throw new OperationError(`Analysis workflow is already in terminal phase '${phase}'.`, SCHEDULER_ERROR.STEP_NOT_READY)
  }
  if (hasJobForSession(sessionId)) {
    throw new OperationError(
      'This session already has an active or pending job in the scheduler.',
      SCHEDULER_ERROR.SESSION_ALREADY_QUEUED,
    )
  }
  const active = findActiveSession(opCtx.db.connection, sessionId)
  if (active) {
    throw new OperationError(
      'Another session is currently active. Nothing was queued.',
      SCHEDULER_ERROR.SESSION_ACTIVE,
      { id: active.id, state: active.state },
    )
  }
}