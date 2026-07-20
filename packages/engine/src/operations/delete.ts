import { z } from 'zod'
import { OperationError } from './errors.js'
import { deleteSessionRecord } from '../persistence/repository.js'
import type { OperationContext } from './context.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const deleteInputSchema = z.object({
  session_id: z.string().describe('Session ID to delete'),
})

export type DeleteInput = z.infer<typeof deleteInputSchema>

export interface DeleteResult {
  api_version: 1
  deleted: boolean
  session_id: string
}

/** Zod output shape for MCP structured output. Mirrors DeleteResult. */
export const deleteOutputSchema = {
  api_version: z.literal(1),
  deleted: z.boolean(),
  session_id: z.string(),
}

export const deleteSessionOperation = {
  id: 'delete_session' as const,
  description:
    'Delete a session and all its child sessions, turns, rounds, parts, and raw exchanges. ' +
    'Rejects if the session has an active or queued job.',
  schema: deleteInputSchema,
  outputSchema: deleteOutputSchema,
  async execute(ctx: OperationContext, input: DeleteInput): Promise<DeleteResult> {
    // Guard: reject if the session has an active or pending scheduler job
    if (ctx.scheduler) {
      const snap = ctx.scheduler.getSnapshot()
      const hasActive = snap.activeJob?.target.sessionId === input.session_id
      const hasPending = snap.pendingJobs.some((j) => j.target.sessionId === input.session_id)
      if (hasActive || hasPending) {
        throw new OperationError(
          'Cannot delete session with an active or queued job',
          'session_already_queued',
        )
      }
    }

    const deleted = deleteSessionRecord(ctx.db.connection, input.session_id)
    if (!deleted) {
      throw new OperationError('Session not found', 'session_not_found')
    }

    return { api_version: 1, deleted: true, session_id: input.session_id }
  },
}
