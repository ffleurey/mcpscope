import { z } from 'zod'

export const createInputSchema = z.object({
  title: z.string().min(1).describe('Session title'),
  id: z.string().optional().describe('Optional explicit 4-char session ID (A-Z 2-9, no O/I/0/1)'),
  compaction: z.enum(['none', 'strip-reasoning']).optional().describe(
    'Compaction strategy applied after each turn. Defaults to strip-reasoning.',
  ),
})

export type CreateInput = z.infer<typeof createInputSchema>

export interface CreateResult {
  api_version: 1
  session: {
    id: string
    title: string
    status: string
    init_status: string
    model: { id: string; name: string }
    mcp: { id: string; name: string } | null
    compaction_strategy: string
    created_at: number
    updated_at: number
  }
}

export const createOperation = {
  id: 'create' as const,
  description:
    'Create a new session using backend-owned defaults (model config, LM connection, MCP profile). '
    + 'Returns immediately; session may still be initializing. '
    + 'Poll with status to wait for state=ready before sending a prompt.',
  schema: createInputSchema,
}
