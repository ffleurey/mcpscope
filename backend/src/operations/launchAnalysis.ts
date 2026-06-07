/**
 * launchAnalysis — backend-owned HTTP operation for creating a session_analysis
 * child session from a target session and completed target turn.
 *
 * This is intentionally not part of the shared CLI/MCP catalog. It exists for
 * backend HTTP routes and frontend flows, while shared CLI/MCP operations stay
 * limited to the published catalog in catalog.ts.
 */
import { z } from 'zod'
import { OperationError } from './errors.js'
import {
  getSessionCreationDefaults,
  getSessionRecord,
  getTurnRecord,
  listLmConnections,
  listModelConfigs,
  updateSessionAnalysisState,
} from '../persistence/repository.js'
import {
  createSession,
  SessionIdConflictError,
  SessionIdGenerationError,
  SessionIdInputError,
} from '../runtime/modelTurns.js'
import { sessionRecordSchema, type McpProfileSnapshot, type ModelProfileSnapshot, type SessionRecord } from '../domain/model.js'
import type { OperationContext } from './context.js'
import { buildAnalysisSystemPrompt, normalizeAnalysisGoal } from '../analysis/systemPrompt.js'
import { runSessionInitialization } from '../runtime/sessionInit.js'
import { ANALYSIS_WORKFLOW_KIND } from '../analysis/workflowKinds.js'
import { isKnownWorkflowKind } from '../analysis/analysisWorkflowFactory.js'
import { getAnalysisTitlePrefix } from '../analysis/analysisSessionPresentation.js'
import type { AnalysisSessionState } from '../analysis/schemas.js'

// ─── Input schema ─────────────────────────────────────────────────────────────

export const launchAnalysisInputSchema = z.object({
  /** The turn in the target session at which analysis should stop (inclusive). */
  target_turn_id: z.string().min(1, 'target_turn_id must not be empty'),
  /** Optional extra guidance for what the analysis should emphasize. */
  analysis_goal: z.string().optional(),
  /** Model config to use. If omitted the general default model config is used. */
  model_config_id: z.string().optional(),
  /** Optional extra launch-time instructions appended to the built-in analysis prompt. */
  additional_instructions: z.string().optional(),
  /** Optional full system prompt override shown and editable in the launch dialog. */
  system_prompt_override: z.string().optional(),
  /** Optional sampling temperature override; defaults to 0.5. */
  temperature: z.number().optional(),
  /** Optional subset of tool names to include in the analysis. */
  selected_tool_names: z.array(z.string().min(1)).optional(),
  /** Limit analysis to tool calls whose tool result is marked as an error. */
  only_failed_tool_calls: z.boolean().optional(),
  /** Optional additional evaluation criteria. */
  evaluation_criteria: z.array(z.string().min(1)).optional(),
  /** The analysis workflow to run. */
  workflow_kind: z.string().optional(),
})

export type LaunchAnalysisInput = z.infer<typeof launchAnalysisInputSchema>

export const launchAnalysisSessionInputSchema = launchAnalysisInputSchema.extend({
  target_session_id: z.string().min(1, 'target_session_id must not be empty'),
})

export type LaunchAnalysisSessionInput = z.infer<typeof launchAnalysisSessionInputSchema>

// ─── Result ───────────────────────────────────────────────────────────────────

export interface LaunchAnalysisResult {
  /** The completed (or errored) analysis child session. */
  session: SessionRecord
}

export const launchAnalysisOutputSchema = {
  session: sessionRecordSchema,
}

export const launchAnalysisSessionOperation = {
  schema: launchAnalysisSessionInputSchema,
  outputSchema: launchAnalysisOutputSchema,
  async execute(ctx: OperationContext, rawInput: unknown): Promise<LaunchAnalysisResult> {
    const input = launchAnalysisSessionInputSchema.parse(rawInput)
    return executeAnalysisLaunch(ctx, input.target_session_id, input)
  },
}

// ─── Execution ────────────────────────────────────────────────────────────────

export async function executeAnalysisLaunch(
  ctx: OperationContext,
  targetSessionId: string,
  rawInput: unknown,
): Promise<LaunchAnalysisResult> {
  const { db } = ctx
  const input = launchAnalysisInputSchema.parse(rawInput)
  const analysisGoal = normalizeAnalysisGoal(input.analysis_goal)
  const additionalInstructions = input.additional_instructions?.trim() ?? ''
  const systemPromptOverride = input.system_prompt_override?.trim() ?? ''
  const temperature = input.temperature ?? 0.5
  const selectedToolNames = [...new Set((input.selected_tool_names ?? []).map((name) => name.trim()).filter(Boolean))]
  const onlyFailedToolCalls = input.only_failed_tool_calls === true
  const evaluationCriteria = [...new Set((input.evaluation_criteria ?? []).map((criterion) => criterion.trim()).filter(Boolean))]
  const workflowKind = input.workflow_kind && isKnownWorkflowKind(input.workflow_kind)
    ? input.workflow_kind
    : ANALYSIS_WORKFLOW_KIND.FULL_SESSION

  type TxResult =
    | { kind: 'target_not_found' }
    | { kind: 'target_not_eligible'; reason: string }
    | { kind: 'target_turn_not_found' }
    | { kind: 'target_turn_not_complete' }
    | { kind: 'default_model_not_configured' }
    | { kind: 'default_model_config_not_found'; modelConfigId: string }
    | { kind: 'model_config_not_found'; modelConfigId: string }
    | { kind: 'lm_connection_not_found'; connectionId: string }
    | { kind: 'id_input_error'; error: SessionIdInputError }
    | { kind: 'id_conflict_error'; error: SessionIdConflictError }
    | { kind: 'id_generation_error'; error: SessionIdGenerationError }
    | { kind: 'created'; session: SessionRecord }

  const requestedModelConfigId = input.model_config_id

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

    // Resolve model config and LM connection
    const modelConfigs = listModelConfigs(db.connection)
    let resolvedModelConfigId = requestedModelConfigId
    if (!resolvedModelConfigId) {
      const defaults = getSessionCreationDefaults(db.connection)
      if (!defaults.defaultModelConfigId) {
        return { kind: 'default_model_not_configured' }
      }
      resolvedModelConfigId = defaults.defaultModelConfigId
      if (!modelConfigs.some(c => c.id === resolvedModelConfigId)) {
        return { kind: 'default_model_config_not_found', modelConfigId: resolvedModelConfigId }
      }
    }

    const modelConfig = modelConfigs.find(c => c.id === resolvedModelConfigId)
    if (!modelConfig) {
      return { kind: 'model_config_not_found', modelConfigId: resolvedModelConfigId }
    }

    const lmConnections = listLmConnections(db.connection)
    const lmConnection = lmConnections.find(c => c.id === modelConfig.connectionId)
    if (!lmConnection) {
      return { kind: 'lm_connection_not_found', connectionId: modelConfig.connectionId }
    }

    // Build model profile snapshot
    const modelProfileSnapshot: ModelProfileSnapshot = {
      id: modelConfig.id,
      name: modelConfig.name,
      connectionBaseUrl: lmConnection.baseUrl,
      apiKey: lmConnection.apiKey ?? null,
      modelKey: modelConfig.modelKey,
      modelDisplayName: modelConfig.modelDisplayName,
      systemPrompt: systemPromptOverride.length > 0
        ? systemPromptOverride
        : buildAnalysisSystemPrompt({
            analysisGoal,
            additionalInstructions,
            workflowKind,
          }),
      temperature,
      reasoning: modelConfig.reasoning ?? null,
      createdAt: modelConfig.createdAt,
      updatedAt: modelConfig.updatedAt,
    }

    const title = `${getAnalysisTitlePrefix(workflowKind)}: ${target.title}`

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
        mcpProfileSnapshots: analysisMcpSnapshot ? [analysisMcpSnapshot] : [],
        compactionStrategy: 'strip-reasoning',
        sessionType: 'session_analysis',
        parentKind: 'session',
        parentId: targetSessionId,
      })

      const wk = isKnownWorkflowKind(workflowKind) ? workflowKind : ANALYSIS_WORKFLOW_KIND.FULL_SESSION
      const initialAnalysisState: AnalysisSessionState = {
        phase: 'bootstrap',
        analysisSessionId: session.id,
        targetSessionId,
        targetTurnId: input.target_turn_id,
        analysisGoal,
        selectedToolNames,
        onlyFailedToolCalls,
        evaluationCriteria,
        workflow_kind: wk,
      }
      updateSessionAnalysisState(db.connection, session.id, initialAnalysisState as unknown as Record<string, unknown>)

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
    case 'default_model_not_configured':
      throw new OperationError(
        'No model config was supplied and no default model config is configured for new sessions.',
        'default_model_not_configured',
      )
    case 'default_model_config_not_found':
      throw new OperationError(
        `Default model config "${result.modelConfigId}" no longer exists.`,
        'default_model_config_not_found',
      )
    case 'model_config_not_found':
      throw new OperationError(
        `Model config "${result.modelConfigId}" not found.`,
        'analysis_model_config_not_found',
      )
    case 'lm_connection_not_found':
      throw new OperationError(
        `LM connection "${result.connectionId}" referenced by the model config no longer exists.`,
        'analysis_lm_connection_not_found',
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
        ctx.chatCompletionGateway,
        ctx.mcpGateway,
        session.id,
        () => { /* no streaming during launch */ },
      )
      return { session }
    }
  }
}
