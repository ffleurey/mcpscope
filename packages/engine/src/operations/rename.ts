import { z } from 'zod'
import { OperationError } from './errors.js'
import { getSessionRecord, updateSessionRecord } from '../persistence/repository.js'
import type { OperationContext } from './context.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const renameInputSchema = z.object({
  session_id: z.string().describe('Session ID to rename'),
  // .max(200) matches the HTTP route's limit — the surfaces must agree.
  title: z.string().trim().min(1).max(200).describe('New session title'),
})

export type RenameInput = z.infer<typeof renameInputSchema>

export interface RenameResult {
  api_version: 1
  session_id: string
  title: string
}

/** Zod output shape for MCP structured output. Mirrors RenameResult. */
export const renameOutputSchema = {
  api_version: z.literal(1),
  session_id: z.string(),
  title: z.string(),
}

export const renameSessionOperation = {
  id: 'rename_session' as const,
  description: 'Rename a session (update its title).',
  schema: renameInputSchema,
  outputSchema: renameOutputSchema,
  async execute(ctx: OperationContext, input: RenameInput): Promise<RenameResult> {
    const session = getSessionRecord(ctx.db.connection, input.session_id)
    if (!session) {
      throw new OperationError('Session not found', 'session_not_found')
    }

    // Callers may bypass the zod schema (the HTTP route parses its own body),
    // so trim here too rather than trusting the schema's .trim().
    const title = input.title.trim()
    if (!title) {
      throw new OperationError('Title must not be empty', 'invalid_title')
    }

    session.title = title
    session.updatedAt = Date.now()
    updateSessionRecord(ctx.db.connection, session)

    return {
      api_version: 1,
      session_id: input.session_id,
      title,
    }
  },
}
