import { z } from 'zod'
import { listInputSchema } from '@mcpscope/shared'
import type { ListInput, ListResult } from '@mcpscope/shared'
import { listOperation as listContract } from '@mcpscope/shared'
import { listSessionSummaries } from '../persistence/repository.js'
import type { OperationContext } from './context.js'

export type { ListInput, ListResult }

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
  ...listContract,
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

export { listInputSchema }
