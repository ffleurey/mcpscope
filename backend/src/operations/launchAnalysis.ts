/**
 * launchAnalysis — backend-owned operation for POST /api/sessions/:sessionId/analyze.
 *
 * Creates a session_analysis child session bound to mcpscope's own restricted
 * analysis MCP endpoint. The caller (frontend or CLI) is responsible for
 * running the prelude init and sending the first analysis turn through the
 * existing streaming infrastructure.
 *
 * This operation is NOT part of the CLI/MCP catalog. It is a backend-owned
 * execution function consumed only by the /api/sessions/:sessionId/analyze route.
 */
import { z } from 'zod'
import { OperationError } from './errors.js'
import {
  findActiveSession,
  getAnalysisDefaults,
  getSessionRecord,
  listAnalysisProfiles,
  listLmConnections,
  listModelConfigs,
} from '../persistence/repository.js'
import {
  createSession,
  SessionIdConflictError,
  SessionIdGenerationError,
  SessionIdInputError,
} from '../runtime/modelTurns.js'
import type { McpProfileSnapshot, ModelProfileSnapshot, SessionRecord } from '../domain/model.js'
import type { OperationContext } from './context.js'

// ─── Input schema ─────────────────────────────────────────────────────────────

export const launchAnalysisInputSchema = z.object({
  /** Analysis profile to use. If omitted the backend default is used. */
  analysis_profile_id: z.string().optional(),
  /** Freeform evaluation instructions and expectations for this session. */
  analysis_prompt: z.string().min(1, 'Analysis prompt must not be empty'),
})

export type LaunchAnalysisInput = z.infer<typeof launchAnalysisInputSchema>

// ─── Result ───────────────────────────────────────────────────────────────────

export interface LaunchAnalysisResult {
  /** The created analysis child session. */
  session: SessionRecord
  /** The analysis prompt the frontend should auto-send as the first turn. */
  analysis_prompt: string
}

// ─── Execution ────────────────────────────────────────────────────────────────

export async function executeAnalysisLaunch(
  ctx: OperationContext,
  targetSessionId: string,
  rawInput: unknown,
): Promise<LaunchAnalysisResult> {
  const { db } = ctx
  const input = launchAnalysisInputSchema.parse(rawInput)

  if (!ctx.analysisMcpUrl) {
    throw new OperationError(
      'Analysis MCP endpoint is not configured on this backend.',
      'analysis_mcp_not_configured',
    )
  }

  type TxResult =
    | { kind: 'target_not_found' }
    | { kind: 'target_not_eligible'; reason: string }
    | { kind: 'profile_not_found'; profileId: string }
    | { kind: 'no_default_profile' }
    | { kind: 'model_config_not_found'; modelConfigId: string }
    | { kind: 'lm_connection_not_found'; connectionId: string }
    | { kind: 'another_session_active'; active: { id: string; state: string } }
    | { kind: 'id_input_error'; error: SessionIdInputError }
    | { kind: 'id_conflict_error'; error: SessionIdConflictError }
    | { kind: 'id_generation_error'; error: SessionIdGenerationError }
    | { kind: 'created'; session: SessionRecord; modelName: string }

  const analysisProfileId = input.analysis_profile_id

  const result: TxResult = db.connection.transaction((): TxResult => {
    // Validate target session
    const target = getSessionRecord(db.connection, targetSessionId)
    if (!target) return { kind: 'target_not_found' }

    // Only sessions whose init has completed are eligible in v1
    if (target.initStatus !== 'ready' && target.initStatus !== 'error') {
      return {
        kind: 'target_not_eligible',
        reason: `Target session is not yet initialized (initStatus = '${target.initStatus}'). Wait for initialization to complete before running analysis.`,
      }
    }

    // Resolve analysis profile
    const profiles = listAnalysisProfiles(db.connection)
    let resolvedProfileId = analysisProfileId

    if (!resolvedProfileId) {
      const defaults = getAnalysisDefaults(db.connection)
      if (!defaults.defaultAnalysisProfileId) {
        return { kind: 'no_default_profile' }
      }
      resolvedProfileId = defaults.defaultAnalysisProfileId
    }

    const profile = profiles.find(p => p.id === resolvedProfileId)
    if (!profile) {
      return { kind: 'profile_not_found', profileId: resolvedProfileId }
    }

    // Resolve model config and LM connection for the analysis profile
    const modelConfigs = listModelConfigs(db.connection)
    const modelConfig = modelConfigs.find(c => c.id === profile.modelConfigId)
    if (!modelConfig) {
      return { kind: 'model_config_not_found', modelConfigId: profile.modelConfigId }
    }

    const lmConnections = listLmConnections(db.connection)
    const lmConnection = lmConnections.find(c => c.id === modelConfig.connectionId)
    if (!lmConnection) {
      return { kind: 'lm_connection_not_found', connectionId: modelConfig.connectionId }
    }

    // Enforce global session lock
    const active = findActiveSession(db.connection)
    if (active) return { kind: 'another_session_active', active }

    // Build model profile snapshot from the analysis profile settings
    const modelProfileSnapshot: ModelProfileSnapshot = {
      id: modelConfig.id,
      name: modelConfig.name,
      connectionBaseUrl: lmConnection.baseUrl,
      apiKey: lmConnection.apiKey ?? null,
      modelKey: modelConfig.modelKey,
      modelDisplayName: modelConfig.modelDisplayName,
      // Use the analysis profile's system prompt, not the model config's default
      systemPrompt: profile.systemPrompt,
      temperature: profile.temperature,
      reasoning: profile.reasoning ?? null,
      createdAt: modelConfig.createdAt,
      updatedAt: modelConfig.updatedAt,
    }

    // Build MCP snapshot pointing to mcpscope's own restricted analysis endpoint
    const now = Date.now()
    const mcpProfileSnapshot: McpProfileSnapshot = {
      id: `mcpscope-analysis`,
      name: 'mcpscope (analysis)',
      url: ctx.analysisMcpUrl!,
      transport: 'streamable-http',
      authType: null,
      authValue: null,
      createdAt: now,
      updatedAt: now,
    }

    // Title: "Analysis: <profile name>"
    const title = `Analysis: ${profile.name}`

    try {
      const session = createSession(db, {
        title,
        modelProfileSnapshot,
        mcpProfileSnapshot,
        compactionStrategy: 'strip-reasoning',
        sessionType: 'session_analysis',
        parentKind: 'session',
        parentId: targetSessionId,
      })

      return { kind: 'created', session, modelName: modelConfig.name }
    } catch (error) {
      if (error instanceof SessionIdInputError) return { kind: 'id_input_error', error }
      if (error instanceof SessionIdConflictError) return { kind: 'id_conflict_error', error }
      if (error instanceof SessionIdGenerationError) return { kind: 'id_generation_error', error }
      throw error
    }
  })()

  switch (result.kind) {
    case 'target_not_found':
      throw new OperationError('Target session not found.', 'not_found')
    case 'target_not_eligible':
      throw new OperationError(result.reason, 'target_session_not_eligible')
    case 'no_default_profile':
      throw new OperationError(
        'No analysis profile supplied and no default analysis profile is configured. '
        + 'Either supply an analysis_profile_id or configure a default analysis profile first.',
        'no_analysis_profile',
      )
    case 'profile_not_found':
      throw new OperationError(
        `Analysis profile "${result.profileId}" not found.`,
        'analysis_profile_not_found',
      )
    case 'model_config_not_found':
      throw new OperationError(
        `Model config "${result.modelConfigId}" referenced by the analysis profile no longer exists.`,
        'analysis_model_config_not_found',
      )
    case 'lm_connection_not_found':
      throw new OperationError(
        `LM connection "${result.connectionId}" referenced by the model config no longer exists.`,
        'analysis_lm_connection_not_found',
      )
    case 'another_session_active':
      throw new OperationError(
        'Another session is currently active. Nothing was started.',
        'another_session_active',
        { id: result.active.id, state: result.active.state },
      )
    case 'id_input_error':
      throw new OperationError(result.error.message, 'invalid_session_id')
    case 'id_conflict_error':
      throw new OperationError(result.error.message, 'duplicate_session_id')
    case 'id_generation_error':
      throw new OperationError(result.error.message, 'session_id_generation_failed')
    case 'created':
      return { session: result.session, analysis_prompt: input.analysis_prompt }
  }
}
