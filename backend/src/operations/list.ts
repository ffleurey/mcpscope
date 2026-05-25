import { z } from 'zod'
import { listSessionSummaries } from '../persistence/repository.js'
import type { OperationContext } from './context.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const listInputSchema = z.object({})

export type ListInput = z.infer<typeof listInputSchema>

/** Canonical snake_case session summary — used by both CLI rendering and MCP results. */
export interface SessionSummary {
  id: string
  title: string
  status: string
  init_status: string
  created_at: number
  updated_at: number
  is_context_exhausted: boolean
  loaded_context_length: number | null
  compaction_strategy: string
  model_profile_snapshot: { name: string }
  mcp_profile_snapshot: { name: string } | null
}

export interface ListResult {
  api_version: 1
  sessions: SessionSummary[]
}

/** Zod output shape for MCP structured output. Mirrors ListResult. */
export const listOutputSchema = {
  api_version: z.literal(1),
  sessions: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    init_status: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
    is_context_exhausted: z.boolean(),
    loaded_context_length: z.number().nullable(),
    compaction_strategy: z.string(),
    model_profile_snapshot: z.object({ name: z.string() }),
    mcp_profile_snapshot: z.object({ name: z.string() }).nullable(),
  })),
}

export const listOperation = {
  id: 'list' as const,
  description: 'List all sessions with ID, title, status, model, and last-updated time.',
  schema: listInputSchema,
  outputSchema: listOutputSchema,
  async execute(ctx: OperationContext, _input: ListInput): Promise<ListResult> {
    const rows = listSessionSummaries(ctx.db.connection)
    return {
      api_version: 1,
      sessions: rows.map(s => ({
        id: s.id,
        title: s.title,
        status: s.status,
        init_status: s.initStatus,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        is_context_exhausted: s.isContextExhausted,
        loaded_context_length: s.loadedContextLength,
        compaction_strategy: s.compactionStrategy,
        model_profile_snapshot: { name: s.modelProfileSnapshot.name },
        mcp_profile_snapshot: s.mcpProfileSnapshot ? { name: s.mcpProfileSnapshot.name } : null,
      })),
    }
  },
}
