import { z } from 'zod'
import { OperationError } from './errors.js'
import {
  findActiveSession,
  getSessionCreationDefaults,
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
} from '../persistence/repository.js'
import {
  createSession,
  SessionIdConflictError,
  SessionIdGenerationError,
  SessionIdInputError,
} from '../runtime/modelTurns.js'
import { sessionRecordSchema, type McpProfileSnapshot, type ModelProfileSnapshot, type SessionRecord } from '../domain/model.js'
import type { OperationContext } from './context.js'

export const launchPrimarySessionInputSchema = z.object({
  session_id: z.string().optional(),
  title: z.string().optional(),
  model_config_id: z.string().optional(),
  mcp_profile_id: z.string().nullable().optional(),
  compaction_strategy: z.enum(['none', 'strip-reasoning']).optional(),
})

export type LaunchPrimarySessionInput = z.infer<typeof launchPrimarySessionInputSchema>

export interface LaunchPrimarySessionResult {
  session: SessionRecord
}

export const launchPrimarySessionOutputSchema = {
  session: sessionRecordSchema,
}

export async function executePrimarySessionLaunch(
  ctx: OperationContext,
  rawInput: unknown,
): Promise<LaunchPrimarySessionResult> {
  const { db } = ctx
  const input = launchPrimarySessionInputSchema.parse(rawInput)

  type TxResult =
    | { kind: 'blocked'; active: { id: string; state: string } }
    | { kind: 'default_model_not_configured' }
    | { kind: 'model_config_not_found'; modelConfigId: string }
    | { kind: 'lm_connection_not_found'; connectionId: string }
    | { kind: 'mcp_profile_not_found'; mcpProfileId: string }
    | { kind: 'id_input_error'; error: SessionIdInputError }
    | { kind: 'id_conflict_error'; error: SessionIdConflictError }
    | { kind: 'id_generation_error'; error: SessionIdGenerationError }
    | { kind: 'created'; session: SessionRecord }

  const result: TxResult = db.connection.transaction((): TxResult => {
    const active = findActiveSession(db.connection)
    if (active) return { kind: 'blocked', active }

    const defaults = getSessionCreationDefaults(db.connection)
    const resolvedModelConfigId = input.model_config_id ?? defaults.defaultModelConfigId
    if (!resolvedModelConfigId) return { kind: 'default_model_not_configured' }

    const modelConfig = listModelConfigs(db.connection).find(record => record.id === resolvedModelConfigId)
    if (!modelConfig) {
      return { kind: 'model_config_not_found', modelConfigId: resolvedModelConfigId }
    }

    const lmConnection = listLmConnections(db.connection).find(record => record.id === modelConfig.connectionId)
    if (!lmConnection) {
      return { kind: 'lm_connection_not_found', connectionId: modelConfig.connectionId }
    }

    const resolvedMcpProfileId = input.mcp_profile_id === undefined
      ? defaults.defaultMcpProfileId
      : input.mcp_profile_id

    let mcpProfileSnapshot: McpProfileSnapshot | null = null
    if (resolvedMcpProfileId) {
      const mcpProfile = listMcpServerProfiles(db.connection).find(record => record.id === resolvedMcpProfileId)
      if (!mcpProfile) {
        return { kind: 'mcp_profile_not_found', mcpProfileId: resolvedMcpProfileId }
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

    const modelProfileSnapshot: ModelProfileSnapshot = {
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
        sessionId: input.session_id,
        title: input.title,
        modelProfileSnapshot,
        mcpProfileSnapshot,
        compactionStrategy: input.compaction_strategy ?? 'strip-reasoning',
        sessionType: 'primary',
      })
      return { kind: 'created', session }
    } catch (error) {
      if (error instanceof SessionIdInputError) return { kind: 'id_input_error', error }
      if (error instanceof SessionIdConflictError) return { kind: 'id_conflict_error', error }
      if (error instanceof SessionIdGenerationError) return { kind: 'id_generation_error', error }
      throw error
    }
  })()

  switch (result.kind) {
    case 'blocked':
      throw new OperationError(
        'Another session is currently active. Nothing was started.',
        'another_session_active',
        { id: result.active.id, state: result.active.state },
      )
    case 'default_model_not_configured':
      throw new OperationError('No default model config is configured for new sessions.', 'default_model_not_configured')
    case 'model_config_not_found':
      throw new OperationError(`Model config "${result.modelConfigId}" not found.`, 'model_config_not_found')
    case 'lm_connection_not_found':
      throw new OperationError(
        `LM connection "${result.connectionId}" referenced by the selected model config no longer exists.`,
        'lm_connection_not_found',
      )
    case 'mcp_profile_not_found':
      throw new OperationError(`MCP profile "${result.mcpProfileId}" not found.`, 'mcp_profile_not_found')
    case 'id_input_error':
      throw new OperationError(result.error.message, 'invalid_session_id')
    case 'id_conflict_error':
      throw new OperationError(result.error.message, 'duplicate_session_id')
    case 'id_generation_error':
      throw new OperationError(result.error.message, 'session_id_generation_failed')
    case 'created': {
      // Auto-enqueue initialization via the scheduler so the frontend can watch
      // the scheduler stream for prelude events instead of calling /initialize separately.
      if (ctx.scheduler) {
        try {
          ctx.scheduler.enqueueInit(ctx, result.session.id)
        } catch {
          // Admission failure (e.g. another session active) is non-fatal here;
          // the frontend can fall back to calling /initialize explicitly.
        }
      }
      return { session: result.session }
    }
  }
}