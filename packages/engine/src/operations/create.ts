import { z } from 'zod'
import { runInTransaction } from '../persistence/connection.js'
import type { OperationError } from './errors.js'
import type { McpProfileSnapshot } from '../domain/model.js'
import type { OperationContext } from './context.js'
import { createSession } from '../runtime/modelTurns.js'
import { getSessionRecord } from '../persistence/repository.js'
import { mapSessionIdError, resolvePrimarySessionInputs } from './sessionCreationShared.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const createInputSchema = z.object({
  // .max(200) matches the HTTP route's limit — the surfaces must agree.
  title: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Session title. When omitted, defaults to 'New session' and is auto-titled from the first prompt.",
    ),
  id: z.string().optional().describe('Optional explicit 4-char session ID (A-Z 2-9, no O/I/0/1)'),
  compaction: z
    .enum(['none', 'strip-reasoning'])
    .optional()
    .describe('Compaction strategy applied after each turn. Defaults to strip-reasoning.'),
  model_config_id: z
    .string()
    .optional()
    .describe('Optional model config ID to use instead of the default'),
  mcp_profile_ids: z
    .array(z.string())
    .optional()
    .describe(
      'Optional list of MCP profile IDs. When provided, replaces the default-enabled selection.',
    ),
  max_tool_rounds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Max tool-call rounds per turn before the turn fails (loop guard). Defaults to the backend default.',
    ),
  wait: z
    .boolean()
    .optional()
    .describe(
      'Block until initialization finishes. The returned init_status is then terminal ' +
        '(ready or error) and the session can accept a prompt immediately — no status polling needed.',
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
    mcp: { id: string; name: string }[]
    compaction_strategy: string
    max_tool_rounds: number | null
    created_at: number
    updated_at: number
  }
}

/** Zod output shape for MCP structured output. Mirrors CreateResult. */
export const createOutputSchema = {
  api_version: z.literal(1),
  session: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    init_status: z.string(),
    model: z.object({ id: z.string(), name: z.string() }),
    mcp: z.array(z.object({ id: z.string(), name: z.string() })),
    compaction_strategy: z.string(),
    max_tool_rounds: z.number().nullable(),
    created_at: z.number(),
    updated_at: z.number(),
  }),
}

export const createOperation = {
  id: 'create' as const,
  description:
    'Create a new session using backend-owned defaults (model config, LM connection, MCP profile). ' +
    'Returns immediately by default (session may still be initializing; poll with status until ' +
    'state=ready). Pass wait=true to block until initialization finishes and skip polling.',
  schema: createInputSchema,
  outputSchema: createOutputSchema,
  async execute(ctx: OperationContext, input: CreateInput): Promise<CreateResult> {
    const { db, logger } = ctx
    let mcpSnapshotsRef: McpProfileSnapshot[] = []

    type TransactionResult =
      | { kind: 'resolution_error'; error: OperationError }
      | { kind: 'id_error'; error: OperationError }
      | {
          kind: 'created'
          session: ReturnType<typeof createSession>
          modelConfigId: string
          modelConfigName: string
        }

    const result: TransactionResult = runInTransaction(db.connection, (): TransactionResult => {
      const resolved = resolvePrimarySessionInputs(ctx.configStore, {
        modelConfigId: input.model_config_id,
        mcpProfileIds: input.mcp_profile_ids,
      })
      if (!resolved.ok) {
        return { kind: 'resolution_error', error: resolved.error }
      }

      try {
        const session = createSession(db, {
          sessionId: input.id,
          title: input.title,
          modelProfileSnapshot: resolved.modelProfileSnapshot,
          mcpProfileSnapshots: resolved.mcpProfileSnapshots,
          compactionStrategy: input.compaction ?? 'strip-reasoning',
          maxToolRounds: input.max_tool_rounds ?? ctx.maxToolRounds,
        })
        mcpSnapshotsRef = resolved.mcpProfileSnapshots
        return {
          kind: 'created',
          session,
          modelConfigId: resolved.modelConfigId,
          modelConfigName: resolved.modelConfigName,
        }
      } catch (error) {
        const mapped = mapSessionIdError(error)
        if (mapped) return { kind: 'id_error', error: mapped }
        throw error
      }
    })

    if (result.kind === 'resolution_error' || result.kind === 'id_error') {
      throw result.error
    }

    const { session, modelConfigId, modelConfigName } = result

    let initJobId: string | null = null
    if (ctx.scheduler) {
      try {
        initJobId = ctx.scheduler.enqueueInit(ctx, session.id).jobId
      } catch (err: unknown) {
        logger?.error(
          {
            sessionId: session.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'Scheduler init enqueue failed (non-fatal — session will initialize on first turn)',
        )
      }
    }

    // wait=true: block until initialization reaches a terminal state and
    // report the final statuses, so callers can send a prompt right away.
    let finalStatus = session.status
    let finalInitStatus = session.initStatus
    let finalUpdatedAt = session.updatedAt
    if (input.wait === true && ctx.scheduler && initJobId) {
      await ctx.scheduler.awaitJob(initJobId)
      const refreshed = getSessionRecord(db.connection, session.id)
      if (refreshed) {
        finalStatus = refreshed.status
        finalInitStatus = refreshed.initStatus
        finalUpdatedAt = refreshed.updatedAt
      }
    }

    return {
      api_version: 1,
      session: {
        id: session.id,
        title: session.title,
        status: finalStatus,
        init_status: finalInitStatus,
        model: { id: modelConfigId, name: modelConfigName },
        mcp: mcpSnapshotsRef.map((s) => ({ id: s.id, name: s.name })),
        compaction_strategy: session.compactionStrategy,
        max_tool_rounds: session.maxToolRounds ?? null,
        created_at: session.createdAt,
        updated_at: finalUpdatedAt,
      },
    }
  },
}
