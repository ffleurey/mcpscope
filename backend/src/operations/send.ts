import { z } from 'zod'
import { OperationError } from './errors.js'
import {
  findActiveSession,
  getNextTurnSequenceNumber,
  getSessionRecord,
  insertTurnRecord,
  listTurnRecordsBySession,
  updateTurnRecord,
} from '../persistence/repository.js'
import { createModelOnlyTurn } from '../runtime/modelTurns.js'
import { createToolEnabledTurn } from '../runtime/toolTurns.js'
import { formatTurnId } from '../domain/hierarchicalIds.js'
import type { TurnRecord } from '../domain/model.js'
import type { OperationContext } from './context.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const sendInputSchema = z.object({
  session_id: z.string().describe('Session ID to send the prompt to'),
  prompt: z.string().min(1).describe('User prompt text to submit to the session'),
})

export type SendInput = z.infer<typeof sendInputSchema>

export interface SendResult {
  api_version: 1
  session_id: string
  turn: { id: string; status: string }
}

/** Zod output shape for MCP structured output. Mirrors SendResult. */
export const sendOutputSchema = {
  api_version: z.literal(1),
  session_id: z.string(),
  turn: z.object({
    id: z.string(),
    status: z.string(),
  }),
}

export const sendOperation = {
  id: 'send' as const,
  description:
    'Start a user turn for an existing session (non-streaming, returns immediately). '
    + 'The session must be fully initialized (status=ready). '
    + 'Poll with status after sending to track turn progress.',
  schema: sendInputSchema,
  outputSchema: sendOutputSchema,
  async execute(ctx: OperationContext, input: SendInput): Promise<SendResult> {
    const { db, lmStudioGateway, mcpGateway, maxToolRounds, logger } = ctx
    const sessionId = input.session_id
    const userContent = input.prompt

    type ReservationResult =
      | { kind: 'not_found' }
      | { kind: 'not_initialized' }
      | { kind: 'another_session_active'; active: { id: string; state: string } }
      | { kind: 'turn_in_progress' }
      | { kind: 'reserved'; session: ReturnType<typeof getSessionRecord>; turn: TurnRecord }

    const reservation: ReservationResult = db.connection.transaction((): ReservationResult => {
      const session = getSessionRecord(db.connection, sessionId)
      if (!session) return { kind: 'not_found' }

      if (session.initStatus !== 'ready') return { kind: 'not_initialized' }

      const active = findActiveSession(db.connection, sessionId)
      if (active) return { kind: 'another_session_active', active }

      const hasActiveTurn = listTurnRecordsBySession(db.connection, sessionId)
        .some(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
      if (hasActiveTurn) return { kind: 'turn_in_progress' }

      const createdAt = Date.now()
      const nextSeq = getNextTurnSequenceNumber(db.connection, sessionId)
      const turn: TurnRecord = {
        id: formatTurnId(sessionId, nextSeq),
        sessionId,
        sequenceNumber: nextSeq,
        status: 'streaming',
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

      insertTurnRecord(db.connection, turn)
      return { kind: 'reserved', session, turn }
    })()

    if (reservation.kind === 'not_found') {
      throw new OperationError('Session not found', 'session_not_found')
    }
    if (reservation.kind === 'not_initialized') {
      throw new OperationError(
        'Session is still initializing or has not reached a ready state. Nothing was queued.',
        'session_not_initialized',
      )
    }
    if (reservation.kind === 'another_session_active') {
      throw new OperationError(
        'Another session is currently active. Nothing was started.',
        'another_session_active',
        { id: reservation.active.id, state: reservation.active.state },
      )
    }
    if (reservation.kind === 'turn_in_progress') {
      throw new OperationError(
        'A turn is already in progress for this session. Nothing was queued.',
        'turn_in_progress',
      )
    }

    const { session, turn } = reservation

    const runTurn = session!.mcpProfileSnapshot
      ? createToolEnabledTurn(db, lmStudioGateway, mcpGateway, {
          sessionId,
          userContent,
          maxToolRounds,
          reservedTurn: turn,
        })
      : createModelOnlyTurn(db, lmStudioGateway, {
          sessionId,
          userContent,
          reservedTurn: turn,
        })

    runTurn.catch((err: unknown) => {
      logger?.error(
        { sessionId, turnId: turn.id, err: err instanceof Error ? err.message : String(err) },
        'Detached turn failed',
      )
      const failedTurn = listTurnRecordsBySession(db.connection, sessionId).find(existing => existing.id === turn.id)
      if (failedTurn && (failedTurn.status === 'draft' || failedTurn.status === 'streaming' || failedTurn.status === 'awaiting-tools')) {
        failedTurn.status = 'error'
        failedTurn.completedAt = Date.now()
        failedTurn.outcome = failedTurn.outcome ?? 'detached-failure'
        updateTurnRecord(db.connection, failedTurn)
      }
    })

    return {
      api_version: 1,
      session_id: sessionId,
      turn: { id: turn.id, status: 'running' },
    }
  },
}
