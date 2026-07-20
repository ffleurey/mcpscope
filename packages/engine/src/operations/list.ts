import { z } from 'zod'
import { listTopLevelSessionSummaries } from '../persistence/repository.js'
import type { OperationContext } from './context.js'
import { computeLifecycleState } from './lifecycleState.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export const listInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Max sessions to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of sessions to skip, for paging through results.'),
})

export type ListInput = z.infer<typeof listInputSchema>

/**
 * Canonical snake_case session summary — a compact top-level row. `list` only
 * surfaces standalone primary sessions; benchmark-run and judge sessions are
 * reached through their benchmark/run, so the row stays minimal by design.
 */
export interface SessionSummary {
  id: string
  title: string
  status: 'initializing' | 'ready' | 'running' | 'error'
  model: string
  updated_at: number
}

export interface ListResult {
  api_version: 1
  sessions: SessionSummary[]
  /** Total top-level sessions available (before limit/offset), for paging. */
  total: number
  limit: number
  offset: number
  has_more: boolean
}

/** Zod output shape for MCP structured output. Mirrors ListResult. */
export const listOutputSchema = {
  api_version: z.literal(1),
  sessions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(['initializing', 'ready', 'running', 'error']),
      model: z.string(),
      updated_at: z.number(),
    }),
  ),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
}

export const listOperation = {
  id: 'list' as const,
  description:
    'List top-level sessions (compact: id, title, status, model, last-updated), most recent first. ' +
    'Only standalone primary sessions — benchmark-run and judge sessions are reached via their benchmark/run. ' +
    'Paginated with limit/offset.',
  schema: listInputSchema,
  outputSchema: listOutputSchema,
  async execute(ctx: OperationContext, input: ListInput): Promise<ListResult> {
    const limit = input.limit ?? DEFAULT_LIMIT
    const offset = input.offset ?? 0
    const { rows, total } = listTopLevelSessionSummaries(ctx.db.connection, { limit, offset })

    return {
      api_version: 1,
      sessions: rows.map((s) => ({
        id: s.id,
        title: s.title,
        status: computeLifecycleState(ctx.db.connection, s),
        model: s.modelProfileSnapshot.name,
        updated_at: s.updatedAt,
      })),
      total,
      limit,
      offset,
      has_more: offset + rows.length < total,
    }
  },
}
