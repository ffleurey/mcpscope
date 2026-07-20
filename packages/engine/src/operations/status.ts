import { z } from 'zod'
import { OperationError } from './errors.js'
import { getSessionRecord, listTurnRecordsBySession } from '../persistence/repository.js'
import type { OperationContext } from './context.js'
import { computeLifecycleState } from './lifecycleState.js'
import { getLatestSessionErrorSummary, getSessionWorkflowKind } from './sessionPresentation.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const statusInputSchema = z.object({
  session_id: z.string().describe('Session ID to check'),
})

export type StatusInput = z.infer<typeof statusInputSchema>

export interface StatusResult {
  api_version: 1
  session: {
    id: string
    state: 'initializing' | 'ready' | 'running' | 'error'
    workflow_kind?: string
    latest_error?: { step_id: string | null; error_kind: string | null; message: string }
  }
  active_turn: { id: string; status: string } | null
  /** Present when the session has a pending job in the scheduler queue. */
  queue_position?: number
}

/** Zod output shape for MCP structured output. Mirrors StatusResult. */
export const statusOutputSchema = {
  api_version: z.literal(1),
  session: z.object({
    id: z.string(),
    state: z.enum(['initializing', 'ready', 'running', 'error']),
    workflow_kind: z.string().optional(),
    latest_error: z
      .object({
        step_id: z.string().nullable(),
        error_kind: z.string().nullable(),
        message: z.string(),
      })
      .optional(),
  }),
  active_turn: z.object({ id: z.string(), status: z.string() }).nullable(),
  queue_position: z.number().int().min(1).optional(),
}

export const statusOperation = {
  id: 'status' as const,
  description:
    'Get the current lifecycle state of a session. ' +
    'States: initializing (setup in progress), ready (can accept a prompt), ' +
    'running (turn in progress), error (failed state). ' +
    'When a session is queued, queue_position gives its 1-based position in the pending queue.',
  schema: statusInputSchema,
  outputSchema: statusOutputSchema,
  async execute(ctx: OperationContext, input: StatusInput): Promise<StatusResult> {
    const { db } = ctx
    const session = getSessionRecord(db.connection, input.session_id)
    if (!session) {
      throw new OperationError('Session not found', 'session_not_found')
    }

    const turns = listTurnRecordsBySession(db.connection, input.session_id)
    const activeTurn =
      [...turns]
        .reverse()
        .find(
          (t) => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools',
        ) ?? null
    const latestTurn = turns.at(-1) ?? null

    const state = computeLifecycleState(db.connection, session)

    // Determine if the session has a pending scheduler job and its queue position.
    let queuePosition: number | undefined
    if (ctx.scheduler && state === 'running' && activeTurn?.status === 'draft') {
      const snap = ctx.scheduler.getSnapshot()
      // A draft turn that's not the active job means it's queued.
      const isActive = snap.activeJob?.target.sessionId === input.session_id
      if (!isActive) {
        const idx = snap.pendingJobs.findIndex((j) => j.target.sessionId === input.session_id)
        if (idx !== -1) {
          queuePosition = idx + 1 // 1-based
        }
      }
    }

    const relevantTurn = state === 'running' ? activeTurn : state === 'error' ? latestTurn : null

    const workflowKind = getSessionWorkflowKind(db.connection, session)
    const latestError =
      state === 'error'
        ? (getLatestSessionErrorSummary(db.connection, session) ?? undefined)
        : undefined

    return {
      api_version: 1,
      session: {
        id: session.id,
        state,
        ...(workflowKind ? { workflow_kind: workflowKind } : {}),
        ...(latestError ? { latest_error: latestError } : {}),
      },
      active_turn: relevantTurn ? { id: relevantTurn.id, status: relevantTurn.status } : null,
      ...(queuePosition !== undefined ? { queue_position: queuePosition } : {}),
    }
  },
}
