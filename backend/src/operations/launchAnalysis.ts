/**
 * launchAnalysis — backend-owned operation for POST /api/sessions/:sessionId/analyze.
 *
 * v2: Creates a session_analysis child session and runs the full analysis
 * workflow synchronously on the backend. Returns the completed analysis session
 * once the workflow finishes (or errors).
 *
 * Supersedes the v1 split-ownership model where the frontend drove prelude
 * init and the first turn.
 */
import { z } from 'zod'
import { OperationError } from './errors.js'
import {
  findActiveSession,
  getAnalysisDefaults,
  getSessionRecord,
  getTurnRecord,
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
import { AnalysisSession } from '../analysis/analysisSession.js'
import { runSessionInitialization } from '../runtime/sessionInit.js'

// ─── Input schema ─────────────────────────────────────────────────────────────

export const launchAnalysisInputSchema = z.object({
  /** The turn in the target session at which analysis should stop (inclusive). */
  target_turn_id: z.string().min(1, 'target_turn_id must not be empty'),
  /** Freeform description of what the analysis should evaluate. */
  analysis_goal: z.string().min(1, 'analysis_goal must not be empty'),
  /** Analysis profile to use. If omitted the backend default is used. */
  analysis_profile_id: z.string().optional(),
})

export type LaunchAnalysisInput = z.infer<typeof launchAnalysisInputSchema>

// ─── Result ───────────────────────────────────────────────────────────────────

export interface LaunchAnalysisResult {
  /** The completed (or errored) analysis child session. */
  session: SessionRecord
}

// ─── Execution ────────────────────────────────────────────────────────────────

export async function executeAnalysisLaunch(
  ctx: OperationContext,
  targetSessionId: string,
  rawInput: unknown,
): Promise<LaunchAnalysisResult> {
  const { db } = ctx
  const input = launchAnalysisInputSchema.parse(rawInput)

  type TxResult =
    | { kind: 'target_not_found' }
    | { kind: 'target_not_eligible'; reason: string }
    | { kind: 'target_turn_not_found' }
    | { kind: 'target_turn_not_complete' }
    | { kind: 'profile_not_found'; profileId: string }
    | { kind: 'no_default_profile' }
    | { kind: 'model_config_not_found'; modelConfigId: string }
    | { kind: 'lm_connection_not_found'; connectionId: string }
    | { kind: 'another_session_active'; active: { id: string; state: string } }
    | { kind: 'id_input_error'; error: SessionIdInputError }
    | { kind: 'id_conflict_error'; error: SessionIdConflictError }
    | { kind: 'id_generation_error'; error: SessionIdGenerationError }
    | { kind: 'created'; session: SessionRecord }

  const analysisProfileId = input.analysis_profile_id

  const result: TxResult = db.connection.transaction((): TxResult => {
    // Validate target session
    const target = getSessionRecord(db.connection, targetSessionId)
    if (!target) return { kind: 'target_not_found' }

    if (target.initStatus !== 'ready' && target.initStatus !== 'error') {
      return {
        kind: 'target_not_eligible',
        reason: `Target session is not yet initialized (initStatus = '${target.initStatus}'). Wait for initialization to complete before running analysis.`,
      }
    }

    // Validate target turn
    const targetTurn = getTurnRecord(db.connection, input.target_turn_id)
    if (!targetTurn) return { kind: 'target_turn_not_found' }
    if (targetTurn.status !== 'complete') return { kind: 'target_turn_not_complete' }

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

    // Resolve model config and LM connection
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

    // Build model profile snapshot
    const modelProfileSnapshot: ModelProfileSnapshot = {
      id: modelConfig.id,
      name: modelConfig.name,
      connectionBaseUrl: lmConnection.baseUrl,
      apiKey: lmConnection.apiKey ?? null,
      modelKey: modelConfig.modelKey,
      modelDisplayName: modelConfig.modelDisplayName,
      systemPrompt: profile.systemPrompt,
      temperature: profile.temperature,
      reasoning: profile.reasoning ?? null,
      createdAt: modelConfig.createdAt,
      updatedAt: modelConfig.updatedAt,
    }

    const title = `Analysis: ${profile.name}`

    try {
      // Build a synthetic MCP profile snapshot pointing to the restricted analysis
      // endpoint (/mcp/analysis), which exposes mcpscope_inspect and mcpscope_status.
      // The analysis LLM can call these tools during assessment turns if it needs detail,
      // and the bootstrap step calls inspect deterministically to load the trace.
      const ts = Date.now()
      const analysisMcpSnapshot: McpProfileSnapshot | null = ctx.analysisMcpUrl
        ? {
            id: 'analysis-mcp-built-in',
            name: 'mcpscope-analysis',
            url: ctx.analysisMcpUrl,
            transport: 'streamable-http',
            authType: null,
            authValue: null,
            createdAt: ts,
            updatedAt: ts,
          }
        : null

      const session = createSession(db, {
        title,
        modelProfileSnapshot,
        mcpProfileSnapshot: analysisMcpSnapshot,
        compactionStrategy: 'strip-reasoning',
        sessionType: 'session_analysis',
        parentKind: 'session',
        parentId: targetSessionId,
      })

      // Pre-create the cursor step so the execute endpoint can always use rehydrateFromDb.
      // This persists targetTurnId and analysisGoal into the cursor step params.
      const analysisInstance = new AnalysisSession(db, ctx.lmStudioGateway, ctx.mcpGateway, {
        analysisSessionId: session.id,
        targetSessionId,
        targetTurnId: input.target_turn_id,
        analysisGoal: input.analysis_goal,
      })
      analysisInstance.initializeCursorStep()

      // Leave initStatus as 'pending' — runSessionInitialization (called below, outside
      // the transaction) will initialize the MCP context (writing mcp-instructions +
      // tool-definitions for the analysis tools) and probe token counts, then set
      // initStatus = 'ready'.
      return { kind: 'created', session }
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
    case 'target_turn_not_found':
      throw new OperationError(
        `Target turn "${input.target_turn_id}" not found.`,
        'target_turn_not_found',
      )
    case 'target_turn_not_complete':
      throw new OperationError(
        `Target turn "${input.target_turn_id}" is not yet complete.`,
        'target_turn_not_complete',
      )
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
    case 'created': {
      const { session } = result
      // Full session initialization: initializes the analysis MCP context
      // (writes mcp-instructions + tool-definitions for mcpscope_inspect and
      // mcpscope_status), probes token counts, and sets initStatus = 'ready'.
      await runSessionInitialization(
        db,
        ctx.lmStudioGateway,
        ctx.mcpGateway,
        session.id,
        () => { /* no streaming during launch */ },
      )
      return { session }
    }
  }
}
