import { z } from 'zod'
import { OperationError } from './errors.js'
import { getSessionRecord } from '../persistence/repository.js'
import type { OperationContext } from './context.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const abortInputSchema = z.object({
  session_id: z.string().describe('Session ID to abort'),
})

export type AbortInput = z.infer<typeof abortInputSchema>

export interface AbortResult {
  api_version: 1
  session_id: string
  outcome: 'aborted' | 'dequeued' | 'not-running'
}

/** Zod output shape for MCP structured output. Mirrors AbortResult. */
export const abortOutputSchema = {
  api_version: z.literal(1),
  session_id: z.string(),
  outcome: z.enum(['aborted', 'dequeued', 'not-running']),
}

export const abortSessionOperation = {
  id: 'abort_session' as const,
  description:
    "Abort a session's active turn (signalling the in-flight model request) " +
    'or dequeue its pending job. Returns the outcome: aborted, dequeued, or not-running.',
  schema: abortInputSchema,
  outputSchema: abortOutputSchema,
  async execute(ctx: OperationContext, input: AbortInput): Promise<AbortResult> {
    // Verify the session exists
    const session = getSessionRecord(ctx.db.connection, input.session_id)
    if (!session) {
      throw new OperationError('Session not found', 'session_not_found')
    }

    if (!ctx.scheduler) {
      throw new OperationError(
        'No execution scheduler is available. The abort operation requires a scheduler context.',
        'scheduler_unavailable',
      )
    }

    const outcome = ctx.scheduler.abortTargeted(input.session_id)

    return {
      api_version: 1,
      session_id: input.session_id,
      outcome,
    }
  },
}
