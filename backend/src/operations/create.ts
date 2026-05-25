import { z } from 'zod'
import { createInputSchema } from '@mcpscope/shared'
import type { CreateInput, CreateResult } from '@mcpscope/shared'
import { createOperation as createContract } from '@mcpscope/shared'
import { OperationError } from '@mcpscope/shared'
import {
  findActiveSession,
  getSessionCreationDefaults,
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
  getSessionRecord,
  updateSessionRecord,
} from '../persistence/repository.js'
import { createSession, SessionIdConflictError, SessionIdGenerationError, SessionIdInputError } from '../runtime/modelTurns.js'
import { runSessionInitialization } from '../runtime/sessionInit.js'
import type { McpProfileSnapshot } from '../domain/model.js'
import type { OperationContext } from './context.js'

export type { CreateInput, CreateResult }

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
  ...createContract,
  outputSchema: createOutputSchema,
  async execute(ctx: OperationContext, input: CreateInput): Promise<CreateResult> {
    const { db, lmStudioGateway, mcpGateway, logger } = ctx
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

    // Fire off initialization in background (caller polls via status)
    runSessionInitialization(db, lmStudioGateway, mcpGateway, session.id, () => {}).catch((err: unknown) => {
      logger?.error(
        { sessionId: session.id, err: err instanceof Error ? err.message : String(err) },
        'Detached session initialization failed',
      )
      const s = getSessionRecord(db.connection, session.id)
      if (s && (s.initStatus === 'initializing' || s.initStatus === 'pending')) {
        s.initStatus = 'error'
        s.updatedAt = Date.now()
        updateSessionRecord(db.connection, s)
      }
    })

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

export { createInputSchema }
