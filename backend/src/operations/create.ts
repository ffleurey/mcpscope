import { z } from 'zod'
import { OperationError } from './errors.js'
import {
  findActiveSession,
  getSessionCreationDefaults,
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
} from '../persistence/repository.js'
import { createSession, SessionIdConflictError, SessionIdGenerationError, SessionIdInputError } from '../runtime/modelTurns.js'
import type { McpProfileSnapshot } from '../domain/model.js'
import type { OperationContext } from './context.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

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

/** Zod output shape for MCP structured output. Mirrors CreateResult. */
export const createOutputSchema = {
  api_version: z.literal(1),
  session: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    init_status: z.string(),
    model: z.object({ id: z.string(), name: z.string() }),
    mcp: z.object({ id: z.string(), name: z.string() }).nullable(),
    compaction_strategy: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  }),
}

export const createOperation = {
  id: 'create' as const,
  description:
    'Create a new session using backend-owned defaults (model config, LM connection, MCP profile). '
    + 'Returns immediately; session may still be initializing. '
    + 'Poll with status to wait for state=ready before sending a prompt.',
  schema: createInputSchema,
  outputSchema: createOutputSchema,
  async execute(ctx: OperationContext, input: CreateInput): Promise<CreateResult> {
    const { db, logger } = ctx
    let mcpSnapshotRef: McpProfileSnapshot | null = null

    type TransactionResult =
      | { kind: 'blocked'; active: { id: string; state: string } }
      | { kind: 'validation_error'; message: string; code: string }
      | { kind: 'id_input_error'; error: SessionIdInputError }
      | { kind: 'id_conflict_error'; error: SessionIdConflictError }
      | { kind: 'id_generation_error'; error: SessionIdGenerationError }
      | { kind: 'created'; session: ReturnType<typeof createSession>; modelConfigId: string; modelConfigName: string }

    const result: TransactionResult = db.connection.transaction((): TransactionResult => {
      const active = findActiveSession(db.connection)
      if (active) return { kind: 'blocked', active }

      const defaults = getSessionCreationDefaults(db.connection)

      if (!defaults.defaultModelConfigId) {
        return { kind: 'validation_error', message: 'No default model config is configured for new sessions.', code: 'default_model_not_configured' }
      }

      const modelConfigs = listModelConfigs(db.connection)
      const modelConfig = modelConfigs.find(c => c.id === defaults.defaultModelConfigId)
      if (!modelConfig) {
        return { kind: 'validation_error', message: `Default model config "${defaults.defaultModelConfigId}" no longer exists.`, code: 'default_model_config_not_found' }
      }

      const lmConnections = listLmConnections(db.connection)
      const lmConnection = lmConnections.find(c => c.id === modelConfig.connectionId)
      if (!lmConnection) {
        return { kind: 'validation_error', message: `LM connection "${modelConfig.connectionId}" referenced by the default model config no longer exists.`, code: 'default_lm_connection_not_found' }
      }

      let mcpProfileSnapshot: McpProfileSnapshot | null = null
      if (defaults.defaultMcpProfileId) {
        const mcpProfiles = listMcpServerProfiles(db.connection)
        const mcpProfile = mcpProfiles.find(p => p.id === defaults.defaultMcpProfileId)
        if (!mcpProfile) {
          return { kind: 'validation_error', message: `Default MCP profile "${defaults.defaultMcpProfileId}" no longer exists.`, code: 'default_mcp_profile_not_found' }
        }
        mcpProfileSnapshot = {
          id: mcpProfile.id,
          name: mcpProfile.name,
          url: mcpProfile.url,
          transport: mcpProfile.transport,
          authType: mcpProfile.authType ?? null,
          authValue: mcpProfile.authValue ?? null,
          createdAt: mcpProfile.createdAt,
          updatedAt: mcpProfile.updatedAt,
        }
      }

      const modelProfileSnapshot = {
        id: modelConfig.id,
        name: modelConfig.name,
        connectionBaseUrl: lmConnection.baseUrl,
        apiKey: lmConnection.apiKey ?? null,
        modelKey: modelConfig.modelKey,
        modelDisplayName: modelConfig.modelDisplayName,
        systemPrompt: modelConfig.systemPrompt,
        temperature: modelConfig.temperature,
        reasoning: modelConfig.reasoning ?? null,
        createdAt: modelConfig.createdAt,
        updatedAt: modelConfig.updatedAt,
      }

      try {
        const session = createSession(db, {
          sessionId: input.id,
          title: input.title,
          modelProfileSnapshot,
          mcpProfileSnapshot,
          compactionStrategy: input.compaction ?? 'strip-reasoning',
        })
        mcpSnapshotRef = mcpProfileSnapshot
        return { kind: 'created', session, modelConfigId: modelConfig.id, modelConfigName: modelConfig.name }
      } catch (error) {
        if (error instanceof SessionIdInputError) return { kind: 'id_input_error', error }
        if (error instanceof SessionIdConflictError) return { kind: 'id_conflict_error', error }
        if (error instanceof SessionIdGenerationError) return { kind: 'id_generation_error', error }
        throw error
      }
    })()

    if (result.kind === 'blocked') {
      throw new OperationError(
        'Another session is currently active. Nothing was started.',
        'another_session_active',
        { id: result.active.id, state: result.active.state },
      )
    }
    if (result.kind === 'validation_error') {
      throw new OperationError(result.message, result.code)
    }
    if (result.kind === 'id_input_error') {
      throw new OperationError(result.error.message, 'invalid_session_id')
    }
    if (result.kind === 'id_conflict_error') {
      throw new OperationError(result.error.message, 'duplicate_session_id')
    }
    if (result.kind === 'id_generation_error') {
      throw new OperationError(result.error.message, 'session_id_generation_failed')
    }

    const { session, modelConfigId, modelConfigName } = result

    // Enqueue initialization via the scheduler so init events flow through the
    // centralized execution stream. Non-fatal: CLI/MCP callers that don't pass
    // a scheduler (or where admission fails) can poll /status and wait for ready.
    if (ctx.scheduler) {
      try {
        ctx.scheduler.enqueueInit(ctx, session.id)
      } catch (err: unknown) {
        logger?.error(
          { sessionId: session.id, err: err instanceof Error ? err.message : String(err) },
          'Scheduler init enqueue failed (non-fatal — session will initialize on first turn)',
        )
      }
    }

    return {
      api_version: 1,
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        init_status: session.initStatus,
        model: { id: modelConfigId, name: modelConfigName },
        mcp: mcpSnapshotRef ? { id: (mcpSnapshotRef as McpProfileSnapshot).id, name: (mcpSnapshotRef as McpProfileSnapshot).name } : null,
        compaction_strategy: session.compactionStrategy,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      },
    }
  },
}
