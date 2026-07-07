import { z } from 'zod'
import { OperationError } from './errors.js'
import {
  listTurnRecordsBySession,
} from '../persistence/repository.js'
import type { OperationContext } from './context.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const sendInputSchema = z.object({
  session_id: z.string().describe('Session ID to send the prompt to'),
  prompt: z.string().min(1).describe('User prompt text to submit to the session'),
  wait: z
    .boolean()
    .optional()
    .describe(
      'Block until the turn reaches a terminal state. The returned turn.status is then '
      + 'complete/error/aborted instead of running and the turn can be inspected immediately — '
      + 'no status polling needed.',
    ),
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
    'Start a user turn for an existing session (non-streaming). '
    + 'The session must be fully initialized (status=ready). '
    + 'Returns immediately by default (poll with status to track progress); '
    + 'pass wait=true to block until the turn completes and skip polling entirely.',
  schema: sendInputSchema,
  outputSchema: sendOutputSchema,
  async execute(ctx: OperationContext, input: SendInput): Promise<SendResult> {
    const sessionId = input.session_id
    const userContent = input.prompt

    if (!ctx.scheduler) {
      throw new OperationError(
        'No execution scheduler is available. The send operation requires a scheduler context.',
        'internal',
      )
    }

    const job = ctx.scheduler.enqueueSession(ctx, sessionId, userContent)
    // The worker may have promoted the draft turn to 'streaming' synchronously
    // before this line runs, so accept either status.
    const reservedTurn = listTurnRecordsBySession(ctx.db.connection, sessionId)
      .find(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')

    if (input.wait === true) {
      await ctx.scheduler.awaitJob(job.jobId)
      const finalTurn = reservedTurn
        ? listTurnRecordsBySession(ctx.db.connection, sessionId).find(t => t.id === reservedTurn.id)
        : undefined
      return {
        api_version: 1,
        session_id: sessionId,
        turn: {
          id: reservedTurn?.id ?? job.jobId,
          status: finalTurn?.status ?? 'complete',
        },
      }
    }

    return {
      api_version: 1,
      session_id: sessionId,
      turn: {
        id: reservedTurn?.id ?? job.jobId,
        status: 'running',
      },
    }
  },
}
