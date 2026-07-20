import {
  getNextTurnNumber,
  getSessionRecord,
  insertTurnRecord,
  listTurnRecordsBySession,
} from '../persistence/repository.js'
import { runInTransaction } from '../persistence/connection.js'
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
    throw new OperationError(
      'Session is already initialized.',
      'session_already_initialized' as const,
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
      throw new OperationError(
        'A prompt is required to enqueue a primary session turn.',
        'validation',
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

  throw new OperationError(
    `Session type '${session.sessionType}' is not supported by the scheduler.`,
    'validation',
  )
}

export function reservePrimaryTurn(opCtx: SchedulerContext, sessionId: string): TurnRecord {
  type ReservationResult = { kind: 'turn_in_progress' } | { kind: 'reserved'; turn: TurnRecord }

  const reservation = runInTransaction(opCtx.db.connection, (): ReservationResult => {
    const hasPendingTurn = listTurnRecordsBySession(opCtx.db.connection, sessionId).some(
      (t) => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools',
    )
    if (hasPendingTurn) return { kind: 'turn_in_progress' }

    const createdAt = Date.now()
    const nextSeq = getNextTurnNumber(opCtx.db.connection, sessionId, null)
    const turn: TurnRecord = {
      id: formatTurnId(sessionId, nextSeq),
      sessionId,
      ownerStepId: null,
      turnNumber: nextSeq,
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
  })

  if (reservation.kind === 'turn_in_progress') {
    throw new OperationError(
      'A turn is already in progress or reserved for this session.',
      SCHEDULER_ERROR.TURN_IN_PROGRESS,
    )
  }

  return reservation.turn
}

export function assertStepJobAllowed(
  opCtx: SchedulerContext,
  sessionId: string,
  hasJobForSession: (sessionId: string) => boolean,
): void {
  const session = getSessionRecord(opCtx.db.connection, sessionId)
  if (!session) {
    throw new OperationError('Session not found', SCHEDULER_ERROR.SESSION_NOT_FOUND)
  }
  if (session.sessionType !== 'session_analysis') {
    throw new OperationError(
      'Step execution is only supported for analysis sessions.',
      SCHEDULER_ERROR.STEP_NOT_READY,
    )
  }
  if (session.initStatus !== 'ready') {
    throw new OperationError(
      `Session is not ready (initStatus = '${session.initStatus}')`,
      SCHEDULER_ERROR.SESSION_NOT_INITIALIZED,
    )
  }

  const analysisState = session.analysisState as { phase?: string } | null
  const phase = analysisState?.phase
  if (phase === 'complete' || phase === 'error') {
    throw new OperationError(
      `Analysis workflow is already in terminal phase '${phase}'.`,
      SCHEDULER_ERROR.STEP_NOT_READY,
    )
  }
  if (hasJobForSession(sessionId)) {
    throw new OperationError(
      'This session already has an active or pending job in the scheduler.',
      SCHEDULER_ERROR.SESSION_ALREADY_QUEUED,
    )
  }
}
