import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import Fastify from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { BackendConfig } from './config.js'
import {
  createTurnInputSchema,
  healthResponseSchema,
} from './domain/apiSchemas.js'
import {
  lmStudioConnectionSchema,
  mcpServerProfileSchema,
  modelConfigSchema,
} from './domain/configuration.js'
import { getDomainModelSummary } from './domain/model.js'
import { deriveContextEntries, deriveTranscriptEntries } from './domain/selectors.js'
import { buildSessionTraceBundle, sessionTraceBundleSchema, type SessionTraceBundle } from './domain/trace.js'
import { listArtifactsBySession } from './analysis/artifactRepository.js'
import { openBackendDatabase } from './persistence/db.js'
import {
  deleteLmConnection,
  deleteMcpServerProfile,
  deleteModelConfig,
  deleteSessionRecord,
  findActiveSession,
  recoverInterruptedState,
  getSessionRecord,
  updateSessionRecord,
  getSessionCreationDefaults,
  upsertSessionCreationDefaults,
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  listRoundRecordsBySession,
  listStepRecordsBySession,
  listTurnRecordsBySession,
  upsertLmConnection,
  upsertMcpServerProfile,
  upsertModelConfig,
  listChildSessionSummaries,
  listAllSessionSummaries,
  type ActiveSessionInfo,
} from './persistence/repository.js'
import {
  createChatCompletion,
  getLoadedContextLength,
  isModelLoaded,
  listModelsWithStatus,
  listModels,
  loadModel as loadLmModel,
  probePromptTokens,
  probePromptTokensDetailed,
  streamChatCompletion,
  unloadModel as unloadLmModel,
} from './services/lmstudio/client.js'
import { callMcpTool, initializeMcpSession, listMcpTools } from './services/mcp/httpClient.js'
import { apiError } from './errors.js'
import type { LmStudioGateway } from './runtime/modelTurns.js'
import type { McpGateway } from './runtime/toolTurns.js'
import { importTraceBundle } from './runtime/traceImport.js'
import { registerMcpTransport } from './mcp/index.js'
import {
  listOperation,
  createOperation,
  statusOperation,
  inspectOperation,
  launchAnalysisOperation,
  OperationError,
  operationErrorResponse,
  operationErrorToHttpStatus,
  type OperationContext,
} from './operations/index.js'
import { ExecutionScheduler } from './runtime/scheduler.js'
import type { SchedulerEvent } from './runtime/scheduler.js'
import { executeCreateExplicit } from './operations/createExplicit.js'
import { executePrimarySessionLaunch } from './operations/launchPrimarySession.js'
import { buildAnalysisSystemPrompt, normalizeAnalysisGoal } from './analysis/systemPrompt.js'

interface RuntimeDependencies {
  lmStudioGateway: LmStudioGateway
  mcpGateway: McpGateway
}

export async function buildBackendApp(
  config: BackendConfig,
  dependencies: RuntimeDependencies = {
    lmStudioGateway: {
      createChatCompletion,
      streamChatCompletion,
      probePromptTokens,
      probePromptTokensDetailed,
      getLoadedContextLength,
    },
    mcpGateway: {
      initializeSession: initializeMcpSession,
      listTools: listMcpTools,
      callTool: callMcpTool,
    },
  },
) {
  const app = Fastify({
    logger: true,
    bodyLimit: 50 * 1024 * 1024, // 50MB — large trace files can be several MB
  })

  /** Map an OperationError to the correct HTTP status + error body. Re-throws non-operation errors. */
  function handleOperationError(err: unknown, reply: { code(n: number): void }): { error: Record<string, unknown> } {
    if (err instanceof OperationError) {
      reply.code(operationErrorToHttpStatus(err.code))
      return operationErrorResponse(err)
    }
    throw err
  }

  // Used by routes that are not yet delegating to the operation layer.
  function anotherSessionActiveError(active: ActiveSessionInfo) {
    return operationErrorResponse(new OperationError(
      'Another session is currently active. Nothing was started.',
      'another_session_active',
      { id: active.id, state: active.state },
    ))
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      reply.code(400).send(apiError('validation', 'Invalid request body', { details: error.issues }))
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    app.log.error({ err: message }, 'Unhandled route error')
    reply.code(500).send(apiError('internal', message || 'Unexpected server error'))
  })

  await app.register(cors, {
    origin: config.corsOrigin,
  })

  // Serve pre-built frontend when BACKEND_STATIC_DIR is set (production/Docker mode)
  if (config.staticDir != null && fs.existsSync(config.staticDir)) {
    await app.register(staticFiles, {
      root: path.resolve(config.staticDir),
      prefix: '/',
      // SPA fallback: non-API routes that don't match a file return index.html
      wildcard: false,
    })
    app.setNotFoundHandler(async (request, reply) => {
      if (!request.url.startsWith('/api/')) {
        return reply.sendFile('index.html')
      }
      return reply.status(404).send(apiError('not_found', 'Not found'))
    })
  }

  const database = openBackendDatabase(config.sqlitePath)
  app.decorate('backendDb', database)

  // On an unclean shutdown (crash, kill, server restart mid-turn) turns and sessions
  // can be left in in-progress states. Recover them before serving any requests so
  // findActiveSession never sees stale 'running' entries that would permanently block
  // new session creation.
  recoverInterruptedState(database.connection)

  // Register MCP Streamable HTTP transport. Routes: POST/GET/DELETE /mcp
  // Operations execute directly against the backend (no loopback HTTP).
  // Build the analysis MCP URL from the backend's own host/port.
  // Analysis sessions use /mcp/analysis which exposes only inspect + status.
  const analysisMcpUrl = `http://${config.host}:${config.port}/mcp/analysis`

  // Backend-owned execution scheduler — created once per app instance.
  const scheduler = new ExecutionScheduler()

  const opCtx: OperationContext = {
    db: database,
    lmStudioGateway: dependencies.lmStudioGateway,
    mcpGateway: dependencies.mcpGateway,
    maxToolRounds: config.maxToolRounds,
    analysisMcpUrl,
    logger: app.log,
    scheduler,
  }
  registerMcpTransport(app, opCtx)

  const toLifecycleState = (summary: {
    id: string
    status: string
    initStatus: string
  }): 'initializing' | 'ready' | 'running' | 'error' => {
    const turns = listTurnRecordsBySession(database.connection, summary.id)
    const activeTurn = [...turns]
      .reverse()
      .find(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
      ?? null
    const latestTurn = turns.at(-1) ?? null

    if (summary.initStatus === 'error' || summary.status === 'error' || latestTurn?.status === 'error') {
      return 'error'
    }
    if (summary.initStatus === 'pending' || summary.initStatus === 'initializing') {
      return 'initializing'
    }
    if (activeTurn) {
      return 'running'
    }
    return 'ready'
  }

  app.get('/api/health', async () => {
    return healthResponseSchema.parse({
      status: 'ok',
      service: 'mcpscope-backend',
      version: config.appVersion ?? 'dev',
      sqlitePath: database.path,
    })
  })

  app.get('/api/runtime', async () => {
    return {
      mode: 'backend-domain-model',
      persistence: 'sqlite',
      streamingTransport: 'http',
      reasoningRetention: 'full',
      mcpSessionLifecycle: 'per-turn',
      maxToolRounds: config.maxToolRounds,
    }
  })

  app.get('/api/domain-model', async () => {
    return {
      ...getDomainModelSummary(),
      schema: database.schema,
    }
  })

  app.get('/api/config-summary', async () => {
    return {
      backend: {
        host: config.host,
        port: config.port,
      },
      storage: {
        sqlitePath: database.path,
        tables: database.schema.tables,
      },
    }
  })

  // ─── Create session (explicit config) ─────────────────────────────────────
  // Used by the frontend, which supplies its own fully-resolved model/MCP snapshots.
  // Business logic is owned by executeCreateExplicit (backend/src/operations/createExplicit.ts).
  app.post('/api/sessions', async (request, reply) => {
    try {
      const result = await executeCreateExplicit(opCtx, request.body)
      reply.code(201)
      return result
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  // ─── Create session from defaults ──────────────────────────────────────────
  app.post('/api/sessions/from-defaults', async (request, reply) => {
    const body = z.object({
      title: z.string().min(1).max(200),
      sessionId: z.string().optional(),
      compactionStrategy: z.enum(['none', 'strip-reasoning']).optional(),
    }).parse(request.body)
    try {
      const result = await createOperation.execute(opCtx, {
        title: body.title,
        ...(body.sessionId !== undefined ? { id: body.sessionId } : {}),
        ...(body.compactionStrategy !== undefined ? { compaction: body.compactionStrategy } : {}),
      })
      reply.code(201)
      return result
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  app.post('/api/session-constructors/primary', async (request, reply) => {
    try {
      const result = await executePrimarySessionLaunch(opCtx, request.body)
      reply.code(201)
      return result
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  app.post('/api/session-constructors/session-analysis', async (request, reply) => {
    const body = z.object({
      target_session_id: z.string(),
      target_turn_id: z.string(),
      analysis_goal: z.string().optional(),
      model_config_id: z.string().optional(),
      additional_instructions: z.string().optional(),
      system_prompt_override: z.string().optional(),
      temperature: z.number().optional(),
      selected_tool_names: z.array(z.string()).optional(),
      only_failed_tool_calls: z.boolean().optional(),
      evaluation_criteria: z.array(z.string()).optional(),
    }).parse(request.body)
    try {
      const result = await launchAnalysisOperation.execute(opCtx, body.target_session_id, {
        target_turn_id: body.target_turn_id,
        analysis_goal: body.analysis_goal,
        model_config_id: body.model_config_id,
        additional_instructions: body.additional_instructions,
        system_prompt_override: body.system_prompt_override,
        temperature: body.temperature,
        selected_tool_names: body.selected_tool_names,
        only_failed_tool_calls: body.only_failed_tool_calls,
        evaluation_criteria: body.evaluation_criteria,
      })
      reply.code(201)
      return result
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  // ─── Session status ─────────────────────────────────────────────────────────
  app.get('/api/analysis/system-prompt-default', async (request) => {
    const { analysis_goal, additional_instructions } = z.object({
      analysis_goal: z.string().optional(),
      additional_instructions: z.string().optional(),
    }).parse(request.query)

    return {
      systemPrompt: additional_instructions === undefined
        ? buildAnalysisSystemPrompt({
            analysisGoal: normalizeAnalysisGoal(analysis_goal),
          })
        : buildAnalysisSystemPrompt({
            analysisGoal: normalizeAnalysisGoal(analysis_goal),
            additionalInstructions: additional_instructions,
          }),
    }
  })

  app.get('/api/sessions/:sessionId/status', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    try {
      return await statusOperation.execute(opCtx, { session_id: sessionId })
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  // ─── Start turn (non-streaming, enqueues via scheduler) ─────────────────────
  app.post('/api/sessions/:sessionId/turns/start', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const { userContent } = z.object({ userContent: z.string().min(1) }).parse(request.body)
    try {
      const job = scheduler.enqueueSession(opCtx, sessionId, userContent)
      // Retrieve the reserved draft turn immediately (mirroring old sendOperation
      // behavior) so the caller gets a turn ID and can poll for completion.
      // The worker may have already promoted the turn from 'draft' to 'streaming'
      // synchronously before this line runs, so accept either status.
      const reservedTurn = listTurnRecordsBySession(database.connection, sessionId)
        .find(t => (t.status === 'draft' || t.status === 'streaming') && t.sessionId === sessionId)
      reply.code(202)
      return {
        api_version: 1 as const,
        session_id: sessionId,
        job: { jobId: job.jobId, status: 'queued' },
        turn: reservedTurn ? { id: reservedTurn.id, status: 'running' } : undefined,
      }
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  // ─── Inspect by hierarchical ID ─────────────────────────────────────────────
  app.get('/api/lookup/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { mode } = z.object({ mode: z.enum(['summary', 'full']).optional() }).parse(request.query)
    try {
      return await inspectOperation.execute(opCtx, { id, short: (mode ?? 'full') === 'summary' })
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  // ─── List sessions ─────────────────────────────────────────────────────────
  // Supports ?include_children=true to return all sessions (primary + children)
  // for tree rendering in the frontend. The operation-layer list always returns
  // primary-only (used by CLI/MCP); only the HTTP route layer expands this.
  app.get('/api/sessions', async (request) => {
    const { include_children } = z.object({
      include_children: z.enum(['true', 'false']).optional(),
    }).parse(request.query)

    if (include_children === 'true') {
      const rows = listAllSessionSummaries(database.connection)
      return {
        api_version: 1,
        sessions: rows.map(s => ({
          id: s.id,
          title: s.title,
          status: toLifecycleState(s),
          init_status: s.initStatus,
          session_type: s.sessionType,
          parent_kind: s.parentKind,
          parent_id: s.parentId,
          created_at: s.createdAt,
          updated_at: s.updatedAt,
          is_context_exhausted: s.isContextExhausted,
          loaded_context_length: s.loadedContextLength,
          compaction_strategy: s.compactionStrategy,
          model_profile_snapshot: { name: s.modelProfileSnapshot.name },
          mcp_profile_snapshot: s.mcpProfileSnapshot ? { name: s.mcpProfileSnapshot.name } : null,
        })),
      }
    }

    return listOperation.execute(opCtx, {})
  })

  app.delete('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const deleted = deleteSessionRecord(database.connection, sessionId)
    if (!deleted) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    reply.code(204)
    return null
  })

  // ─── Child sessions of a session parent ────────────────────────────────────
  app.get('/api/sessions/:sessionId/children', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    const children = listChildSessionSummaries(database.connection, 'session', sessionId)
    return {
      api_version: 1,
      parent_session_id: sessionId,
      children: children.map(s => ({
        id: s.id,
        title: s.title,
        status: toLifecycleState(s),
        init_status: s.initStatus,
        session_type: s.sessionType,
        parent_kind: s.parentKind,
        parent_id: s.parentId,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        is_context_exhausted: s.isContextExhausted,
        loaded_context_length: s.loadedContextLength,
        compaction_strategy: s.compactionStrategy,
        model_profile_snapshot: { name: s.modelProfileSnapshot.name },
        mcp_profile_snapshot: s.mcpProfileSnapshot ? { name: s.mcpProfileSnapshot.name } : null,
      })),
    }
  })

  // ─── Launch analysis session ────────────────────────────────────────────────
  // Runs the full backend-owned analysis v2 workflow for a target session and turn.
  // Returns the completed (or errored) analysis child session when the workflow finishes.
  app.post('/api/sessions/:sessionId/analyze', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    try {
      const result = await launchAnalysisOperation.execute(opCtx, sessionId, request.body)
      reply.code(201)
      return result
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  // ─── Execute analysis session (SSE streaming) ─────────────────────────────
  // Enqueues the analysis session in the scheduler and streams all progress
  // events (turn tokens + deterministic step events) back as server-sent events.
  // Replaces the previous direct-execution path.
  app.post('/api/sessions/:sessionId/execute', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const { single_step } = z.object({ single_step: z.string().optional() }).parse(request.query)
    const isSingleStep = single_step === 'true' || single_step === '1'

    // Validate session before enqueue
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    if (session.sessionType !== 'session_analysis') {
      reply.code(400)
      return apiError('validation', 'Session is not an analysis session.')
    }

    let job: Awaited<ReturnType<typeof scheduler.enqueueSession | typeof scheduler.enqueueStep>>
    try {
      if (isSingleStep) {
        // Find the cursor step and enqueue a single-step job
        const steps = listStepRecordsBySession(database.connection, sessionId)
        const cursorStep = steps.find(s => s.stepTypeKey === 'analysis_v2_cursor')
        if (!cursorStep) {
          reply.code(422)
          return apiError('validation', 'Analysis session has no cursor step — it may not have been initialized correctly.')
        }
        job = scheduler.enqueueStep(opCtx, sessionId, cursorStep.id)
      } else {
        job = scheduler.enqueueSession(opCtx, sessionId)
      }
    } catch (err) {
      return handleOperationError(err, reply)
    }

    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache, no-transform')
    reply.raw.setHeader('connection', 'keep-alive')

    const emitSseEvent = (event: { type: string; [key: string]: unknown }) => {
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    await new Promise<void>(resolve => {
      const unsubscribe = scheduler.subscribe((schedulerEvent: SchedulerEvent) => {
        if (schedulerEvent.type === 'scheduler-execution-event' && schedulerEvent.jobId === job.jobId) {
          emitSseEvent(schedulerEvent.event as { type: string; [key: string]: unknown })
          if (
            schedulerEvent.event.type === 'analysis-complete'
            || schedulerEvent.event.type === 'analysis-failed'
          ) {
            unsubscribe()
            resolve()
          }
          return
        }
        if (schedulerEvent.type === 'scheduler-job-completed' && schedulerEvent.job.jobId === job.jobId) {
          unsubscribe()
          resolve()
          return
        }
        if (schedulerEvent.type === 'scheduler-job-failed' && schedulerEvent.job.jobId === job.jobId) {
          emitSseEvent({ type: 'analysis-failed', message: schedulerEvent.job.error ?? 'Job failed' })
          unsubscribe()
          resolve()
        }
        if (
          schedulerEvent.type === 'scheduler-job-removed'
          && schedulerEvent.jobId === job.jobId
        ) {
          unsubscribe()
          resolve()
        }
      })

      const snapshot = scheduler.getSnapshot()
      const stillPresent = snapshot.activeJob?.jobId === job.jobId
        || snapshot.pendingJobs.some(j => j.jobId === job.jobId)
      if (!stillPresent && snapshot.lastTerminalJob?.jobId === job.jobId) {
        if (snapshot.lastTerminalJob.outcome === 'failed') {
          emitSseEvent({ type: 'analysis-failed', message: snapshot.lastTerminalJob.error ?? 'Job failed' })
        }
        unsubscribe()
        resolve()
      }
    })

    reply.raw.end()
  })

  app.patch('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const { title } = z.object({ title: z.string().min(1).max(200) }).parse(request.body)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    session.title = title.trim()
    session.updatedAt = Date.now()
    updateSessionRecord(database.connection, session)
    return { session }
  })

  app.get('/api/lm-connections', async () => {
    return {
      lmConnections: listLmConnections(database.connection),
    }
  })

  app.put('/api/lm-connections/:connectionId', async (request, reply) => {
    const { connectionId } = z.object({ connectionId: z.string() }).parse(request.params)
    const record = lmStudioConnectionSchema.parse(request.body)
    if (record.id !== connectionId) {
      reply.code(400)
      return apiError('validation', 'Connection ID mismatch')
    }
    upsertLmConnection(database.connection, record)
    return { lmConnection: record }
  })

  app.delete('/api/lm-connections/:connectionId', async (request, reply) => {
    const { connectionId } = z.object({ connectionId: z.string() }).parse(request.params)
    const referencedByModelConfig = listModelConfigs(database.connection)
      .some(modelConfig => modelConfig.connectionId === connectionId)
    if (referencedByModelConfig) {
      reply.code(409)
      return apiError('validation', 'Cannot delete this LM connection because one or more model configs still reference it. Delete those model configs first.', {
        code: 'lm_connection_in_use',
      })
    }
    const deleted = deleteLmConnection(database.connection, connectionId)
    if (!deleted) {
      reply.code(404)
      return apiError('not_found', 'LM connection not found')
    }
    reply.code(204)
    return null
  })

  app.get('/api/model-configs', async () => {
    return {
      modelConfigs: listModelConfigs(database.connection),
    }
  })

  app.put('/api/model-configs/:modelConfigId', async (request, reply) => {
    const { modelConfigId } = z.object({ modelConfigId: z.string() }).parse(request.params)
    const record = modelConfigSchema.parse(request.body)
    if (record.id !== modelConfigId) {
      reply.code(400)
      return apiError('validation', 'Model config ID mismatch')
    }
    upsertModelConfig(database.connection, record)
    return { modelConfig: record }
  })

  app.delete('/api/model-configs/:modelConfigId', async (request, reply) => {
    const { modelConfigId } = z.object({ modelConfigId: z.string() }).parse(request.params)
    const defaults = getSessionCreationDefaults(database.connection)
    if (defaults.defaultModelConfigId === modelConfigId) {
      reply.code(409)
      return apiError('validation', 'Cannot delete this model config because it is currently set as the default for new sessions. Change or clear the default first.', {
        code: 'default_model_config_in_use',
      })
    }
    const deleted = deleteModelConfig(database.connection, modelConfigId)
    if (!deleted) {
      reply.code(404)
      return apiError('not_found', 'Model config not found')
    }
    reply.code(204)
    return null
  })

  app.get('/api/mcp-profiles', async () => {
    return {
      mcpProfiles: listMcpServerProfiles(database.connection),
    }
  })

  app.put('/api/mcp-profiles/:mcpProfileId', async (request, reply) => {
    const { mcpProfileId } = z.object({ mcpProfileId: z.string() }).parse(request.params)
    const record = mcpServerProfileSchema.parse(request.body)
    if (record.id !== mcpProfileId) {
      reply.code(400)
      return apiError('validation', 'MCP profile ID mismatch')
    }
    upsertMcpServerProfile(database.connection, record)
    return { mcpProfile: record }
  })

  app.delete('/api/mcp-profiles/:mcpProfileId', async (request, reply) => {
    const { mcpProfileId } = z.object({ mcpProfileId: z.string() }).parse(request.params)
    const defaults = getSessionCreationDefaults(database.connection)
    if (defaults.defaultMcpProfileId === mcpProfileId) {
      reply.code(409)
      return apiError('validation', 'Cannot delete this MCP profile because it is currently set as the default for new sessions. Change or clear the default first.', {
        code: 'default_mcp_profile_in_use',
      })
    }
    const deleted = deleteMcpServerProfile(database.connection, mcpProfileId)
    if (!deleted) {
      reply.code(404)
      return apiError('not_found', 'MCP profile not found')
    }
    reply.code(204)
    return null
  })

  app.get('/api/session-creation-defaults', async () => {
    const defaults = getSessionCreationDefaults(database.connection)
    return { sessionCreationDefaults: defaults }
  })

  const sessionCreationDefaultsInputSchema = z.object({
    defaultModelConfigId: z.string().nullable(),
    defaultMcpProfileId: z.string().nullable(),
  })

  app.put('/api/session-creation-defaults', async (request, reply) => {
    const { defaultModelConfigId, defaultMcpProfileId } = sessionCreationDefaultsInputSchema.parse(request.body)

    if (defaultModelConfigId !== null) {
      const modelConfigs = listModelConfigs(database.connection)
      if (!modelConfigs.some(c => c.id === defaultModelConfigId)) {
        reply.code(422)
        return apiError('validation', `Model config "${defaultModelConfigId}" not found.`, {
          code: 'default_model_config_not_found',
        })
      }
    }

    if (defaultMcpProfileId !== null) {
      const mcpProfiles = listMcpServerProfiles(database.connection)
      if (!mcpProfiles.some(p => p.id === defaultMcpProfileId)) {
        reply.code(422)
        return apiError('validation', `MCP profile "${defaultMcpProfileId}" not found.`, {
          code: 'default_mcp_profile_not_found',
        })
      }
    }

    const updatedDefaults = {
      defaultModelConfigId,
      defaultMcpProfileId,
      updatedAt: Date.now(),
    }
    upsertSessionCreationDefaults(database.connection, updatedDefaults)
    return { sessionCreationDefaults: updatedDefaults }
  })

  app.post('/api/lm-connections/test', async (_request, reply) => {
    const { baseUrl, apiKey } = z
      .object({ baseUrl: z.string().url(), apiKey: z.string().nullable().optional() })
      .parse(_request.body)
    try {
      const result = await listModels(baseUrl, apiKey ?? undefined)
      return { models: result.data?.map(m => m.id ?? '').filter(Boolean) ?? [] }
    } catch (e) {
      app.log.warn({ baseUrl, err: e instanceof Error ? e.message : String(e) }, 'LM connection test failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'LM Studio unreachable', {
        code: 'lm_studio_unreachable',
        details: { baseUrl },
      })
    }
  })

  app.post('/api/lm-connections/models', async (_request, reply) => {
    const { baseUrl, apiKey } = z
      .object({ baseUrl: z.string().url(), apiKey: z.string().nullable().optional() })
      .parse(_request.body)
    try {
      const models = await listModelsWithStatus(baseUrl, apiKey ?? undefined)
      return { models }
    } catch (e) {
      app.log.warn({ baseUrl, err: e instanceof Error ? e.message : String(e) }, 'LM models listing failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'LM Studio unreachable', {
        code: 'lm_studio_unreachable',
        details: { baseUrl },
      })
    }
  })

  app.post('/api/lm-connections/models/load', async (_request, reply) => {
    const { baseUrl, apiKey, modelKey } = z
      .object({ baseUrl: z.string().url(), apiKey: z.string().nullable().optional(), modelKey: z.string().min(1) })
      .parse(_request.body)
    try {
      await loadLmModel(baseUrl, apiKey ?? undefined, modelKey)
      return { ok: true }
    } catch (e) {
      app.log.warn({ baseUrl, modelKey, err: e instanceof Error ? e.message : String(e) }, 'LM model load failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'LM model load failed', {
        code: 'lm_model_load_failed',
        details: { baseUrl, modelKey },
      })
    }
  })

  app.post('/api/lm-connections/models/unload', async (_request, reply) => {
    const { baseUrl, apiKey, instanceId } = z
      .object({ baseUrl: z.string().url(), apiKey: z.string().nullable().optional(), instanceId: z.string().min(1) })
      .parse(_request.body)
    try {
      await unloadLmModel(baseUrl, apiKey ?? undefined, instanceId)
      return { ok: true }
    } catch (e) {
      app.log.warn({ baseUrl, instanceId, err: e instanceof Error ? e.message : String(e) }, 'LM model unload failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'LM model unload failed', {
        code: 'lm_model_unload_failed',
        details: { baseUrl, instanceId },
      })
    }
  })


  app.post('/api/mcp-profiles/test', async (_request, reply) => {
    const { url } = z.object({ url: z.string().url() }).parse(_request.body)
    try {
      const init = await initializeMcpSession(url)
      const toolsResult = await listMcpTools(url, init.sessionId)
      return {
        serverName: init.serverInfo.name,
        serverVersion: init.serverInfo.version,
        tools: toolsResult.tools.map(t => t.name),
      }
    } catch (e) {
      app.log.error({ url, err: e instanceof Error ? e.message : String(e) }, 'MCP profile test failed')
      reply.code(503)
      return apiError('upstream', e instanceof Error ? e.message : 'MCP server unreachable', {
        details: { url },
      })
    }
  })

  app.post('/api/sessions/preflight', async (_request, reply) => {
    const { lmConnectionSnapshot, mcpProfileSnapshot, selectedModel } = z
      .object({
        lmConnectionSnapshot: z.object({ baseUrl: z.string(), apiKey: z.string().nullable().optional() }),
        mcpProfileSnapshot: z.object({ url: z.string() }).nullable().optional(),
        selectedModel: z.object({
          modelKey: z.string().min(1),
          modelDisplayName: z.string().min(1).optional(),
        }),
      })
      .parse(_request.body)

    // Enforce the global single-active-session rule here so the UI gets an immediate,
    // consistent rejection before any network probes. The createSession call that
    // follows preflight in the UI flow also checks, but checking here prevents a
    // misleading "preflight OK" → "create 409" sequence that could confuse clients.
    const activeBeforePreflight = findActiveSession(database.connection)
    if (activeBeforePreflight) {
      reply.code(409)
      return anotherSessionActiveError(activeBeforePreflight)
    }

    // Check LM Studio reachability
    let listedByCompatApi: boolean
    try {
      const modelList = await listModels(lmConnectionSnapshot.baseUrl, lmConnectionSnapshot.apiKey ?? undefined)
      listedByCompatApi = (modelList.data?.some((m) => m.id === selectedModel.modelKey) ?? false)
    } catch (e) {
      app.log.warn({ baseUrl: lmConnectionSnapshot.baseUrl, err: e instanceof Error ? e.message : String(e) }, 'Preflight: LM Studio unreachable')
      reply.code(503)
      return apiError('upstream', 'Cannot reach LM Studio. Check that it is running and accessible.', {
        code: 'lm_studio_unreachable',
        details: { baseUrl: lmConnectionSnapshot.baseUrl },
      })
    }

    const loaded = await isModelLoaded(
      lmConnectionSnapshot.baseUrl,
      lmConnectionSnapshot.apiKey ?? undefined,
      selectedModel.modelKey,
    )
    if (loaded === false || (loaded === null && !listedByCompatApi)) {
      const label = selectedModel.modelDisplayName ?? selectedModel.modelKey
      reply.code(409)
      return apiError('validation', `Selected model "${label}" is not loaded in LM Studio. Load it and try again.`, {
        code: 'lm_model_not_loaded',
        details: {
          modelKey: selectedModel.modelKey,
          modelDisplayName: selectedModel.modelDisplayName ?? null,
          baseUrl: lmConnectionSnapshot.baseUrl,
        },
      })
    }

    // Check MCP reachability if profile supplied
    if (mcpProfileSnapshot?.url) {
      try {
        await initializeMcpSession(mcpProfileSnapshot.url)
      } catch (e) {
        app.log.warn({ url: mcpProfileSnapshot.url, err: e instanceof Error ? e.message : String(e) }, 'Preflight: MCP server unreachable')
        reply.code(503)
        return apiError('upstream', 'Cannot reach MCP server. Check that it is running and accessible.', {
          code: 'mcp_unreachable',
          details: { url: mcpProfileSnapshot.url },
        })
      }
    }

    return { ok: true }
  })

  app.get('/api/sessions/:sessionId/trace', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    const turns = listTurnRecordsBySession(database.connection, sessionId)
    const rounds = listRoundRecordsBySession(database.connection, sessionId)
    const parts = listPartRecordsBySession(database.connection, sessionId)
    const rawExchanges = listRawExchangeRecordsBySession(database.connection, sessionId)
    return buildSessionTraceBundle({
      session,
      steps: listStepRecordsBySession(database.connection, sessionId),
      turns,
      rounds,
      parts,
      rawExchanges,
      artifacts: listArtifactsBySession(database.connection, sessionId),
      transcript: deriveTranscriptEntries(parts),
      context: deriveContextEntries(parts),
    })
  })

  app.post('/api/traces/import', async (request, reply) => {
    const input = sessionTraceBundleSchema.parse(request.body) as SessionTraceBundle
    const importedSession = importTraceBundle(database, input)
    reply.code(201)
    return { session: importedSession }
  })

  app.post('/api/sessions/:sessionId/turns', async (request, reply) => {
    // Compatibility shim — delegates execution to the scheduler.
    // If the session has not been initialized, initialization is run inline first
    // for backward compatibility. Awaits completion and returns turn/rounds/parts.
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const input = createTurnInputSchema.parse(request.body)

    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }

    // ── Inline init if needed (backward compat for test clients) ────────────
    if (session.initStatus === 'pending' || session.initStatus === 'initializing') {
      try {
        const initJob = scheduler.enqueueInit(opCtx, sessionId)
        await scheduler.awaitJob(initJob.jobId)
      } catch (err) {
        if (err instanceof OperationError && err.code === 'session_already_initialized') {
          // Already ready — continue
        } else {
          return handleOperationError(err, reply)
        }
      }
    }

    // ── Enqueue turn via scheduler ───────────────────────────────────────────
    let job: ReturnType<typeof scheduler.enqueueSession>
    try {
      job = scheduler.enqueueSession(opCtx, sessionId, input.userContent)
    } catch (err) {
      return handleOperationError(err, reply)
    }

    // Capture reserved turn ID right after enqueue (draft or already streaming)
    const reservedTurn = listTurnRecordsBySession(database.connection, sessionId)
      .find(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
    const turnId = reservedTurn?.id

    // ── Await job completion ─────────────────────────────────────────────────
    await scheduler.awaitJob(job.jobId)

    // ── Fetch completed turn data from DB ────────────────────────────────────
    const completedTurn = turnId
      ? listTurnRecordsBySession(database.connection, sessionId).find(t => t.id === turnId)
      : null
    if (!completedTurn) {
      reply.code(500)
      return apiError('internal', 'Turn could not be located after execution.')
    }
    const rounds = listRoundRecordsBySession(database.connection, sessionId)
      .filter(r => r.turnId === completedTurn.id)
    const parts = listPartRecordsBySession(database.connection, sessionId)
      .filter(p => p.turnId === completedTurn.id)

    reply.code(201)
    return { turn: completedTurn, round: rounds[0], rounds, parts }
  })

  app.post('/api/sessions/:sessionId/initialize', async (request, reply) => {
    // Routes session initialization through the scheduler.
    // Prelude events flow as scheduler-execution-events and are streamed back as SSE
    // for backward compatibility with clients that subscribe to this endpoint directly.
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)

    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }

    // If already initialized, emit existing parts + trace inline and return
    if (session.initStatus === 'ready') {
      reply.hijack()
      reply.raw.statusCode = 200
      reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
      reply.raw.setHeader('cache-control', 'no-cache, no-transform')
      reply.raw.setHeader('connection', 'keep-alive')
      const parts = listPartRecordsBySession(database.connection, sessionId)
      const trace = buildSessionTraceBundle({
        session,
        steps: listStepRecordsBySession(database.connection, sessionId),
        turns: listTurnRecordsBySession(database.connection, sessionId),
        rounds: listRoundRecordsBySession(database.connection, sessionId),
        parts,
        rawExchanges: listRawExchangeRecordsBySession(database.connection, sessionId),
        artifacts: listArtifactsBySession(database.connection, sessionId),
        transcript: deriveTranscriptEntries(parts),
        context: deriveContextEntries(parts),
      })
      for (const part of parts.filter(p => p.turnId === null)) {
        reply.raw.write(`event: part-committed\ndata: ${JSON.stringify({ type: 'part-committed', part })}\n\n`)
      }
      reply.raw.write(`event: prelude-complete\ndata: ${JSON.stringify({ type: 'prelude-complete', trace })}\n\n`)
      reply.raw.end()
      return
    }

    // Enqueue init via scheduler
    let job: ReturnType<typeof scheduler.enqueueInit>
    try {
      job = scheduler.enqueueInit(opCtx, sessionId)
    } catch (err) {
      return handleOperationError(err, reply)
    }

    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache, no-transform')
    reply.raw.setHeader('connection', 'keep-alive')

    const emitSseEvent = (event: { type: string; [key: string]: unknown }) => {
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    await new Promise<void>(resolve => {
      const unsubscribe = scheduler.subscribe((schedulerEvent: SchedulerEvent) => {
        if (schedulerEvent.type === 'scheduler-execution-event' && schedulerEvent.jobId === job.jobId) {
          emitSseEvent(schedulerEvent.event as { type: string; [key: string]: unknown })
          if (schedulerEvent.event.type === 'prelude-complete' || schedulerEvent.event.type === 'prelude-failed') {
            unsubscribe()
            resolve()
          }
          return
        }
        if (schedulerEvent.type === 'scheduler-job-completed' && schedulerEvent.job.jobId === job.jobId) {
          unsubscribe()
          resolve()
          return
        }
        if (schedulerEvent.type === 'scheduler-job-failed' && schedulerEvent.job.jobId === job.jobId) {
          emitSseEvent({ type: 'prelude-failed', message: schedulerEvent.job.error ?? 'Initialization failed' })
          unsubscribe()
          resolve()
        }
      })
      const snap = scheduler.getSnapshot()
      const stillPresent = snap.activeJob?.jobId === job.jobId
        || snap.pendingJobs.some(j => j.jobId === job.jobId)
      if (!stillPresent && snap.lastTerminalJob?.jobId === job.jobId) {
        if (snap.lastTerminalJob.outcome === 'failed') {
          emitSseEvent({ type: 'prelude-failed', message: snap.lastTerminalJob.error ?? 'Initialization failed' })
        }
        unsubscribe()
        resolve()
      }
    })

    reply.raw.end()
  })

  app.post('/api/sessions/:sessionId/turns/stream', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const input = createTurnInputSchema.parse(request.body)

    // Enqueue the session target via the scheduler.
    // The scheduler handles turn reservation, global-lock checks, and deduplication.
    let job: Awaited<ReturnType<typeof scheduler.enqueueSession>>
    try {
      job = scheduler.enqueueSession(opCtx, sessionId, input.userContent)
    } catch (err) {
      return handleOperationError(err, reply)
    }

    // Hijack the response to stream turn events from the scheduler.
    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache, no-transform')
    reply.raw.setHeader('connection', 'keep-alive')

    const emitSseEvent = (event: { type: string; [key: string]: unknown }) => {
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    await new Promise<void>(resolve => {
      const unsubscribe = scheduler.subscribe((schedulerEvent: SchedulerEvent) => {
        // Relay execution events for this job/session as SSE
        if (schedulerEvent.type === 'scheduler-execution-event' && schedulerEvent.jobId === job.jobId) {
          emitSseEvent(schedulerEvent.event as { type: string; [key: string]: unknown })
          // Close stream when turn reaches a terminal event
          if (schedulerEvent.event.type === 'turn-committed' || schedulerEvent.event.type === 'turn-failed') {
            unsubscribe()
            resolve()
          }
          return
        }
        // Close stream if job failed before reaching a terminal turn event
        if (schedulerEvent.type === 'scheduler-job-failed' && schedulerEvent.job.jobId === job.jobId) {
          emitSseEvent({ type: 'turn-failed', turnId: null, message: schedulerEvent.job.error ?? 'Job failed' })
          unsubscribe()
          resolve()
          return
        }
        // Close stream if job completed without a terminal turn event (e.g. error absorbed)
        if (schedulerEvent.type === 'scheduler-job-completed' && schedulerEvent.job.jobId === job.jobId) {
          unsubscribe()
          resolve()
          return
        }
        // Close stream if job was removed
        if (schedulerEvent.type === 'scheduler-job-removed' && schedulerEvent.jobId === job.jobId) {
          unsubscribe()
          resolve()
          return
        }
      })

      // Guard: if the job is already gone from the scheduler by the time we subscribe,
      // resolve immediately.
      const snapshot = scheduler.getSnapshot()
      const stillPresent = snapshot.activeJob?.jobId === job.jobId
        || snapshot.pendingJobs.some(j => j.jobId === job.jobId)
      if (!stillPresent && snapshot.lastTerminalJob?.jobId === job.jobId) {
        if (snapshot.lastTerminalJob.outcome === 'failed') {
          emitSseEvent({ type: 'turn-failed', turnId: null, message: snapshot.lastTerminalJob.error ?? 'Job failed' })
        }
        unsubscribe()
        resolve()
      }
    })

    reply.raw.end()
  })

  // ─── Scheduler monitoring and control routes ───────────────────────────────

  // GET /api/scheduler/snapshot — current queue and execution state
  app.get('/api/scheduler/snapshot', async () => {
    return scheduler.getSnapshot()
  })

  // POST /api/scheduler/pause — pause after current step boundary
  app.post('/api/scheduler/pause', async () => {
    scheduler.pause()
    return { ok: true, controlState: 'paused' }
  })

  // POST /api/scheduler/resume — resume from paused state
  app.post('/api/scheduler/resume', async () => {
    scheduler.resume()
    return { ok: true, controlState: 'running' }
  })

  // DELETE /api/scheduler/jobs/:jobId — remove a pending job
  app.delete('/api/scheduler/jobs/:jobId', async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params)
    const removed = scheduler.removeJob(jobId)
    if (!removed) {
      reply.code(404)
      return apiError('not_found', 'Job not found or already active/completed')
    }
    reply.code(204)
    return null
  })

  // POST /api/scheduler/enqueue — generic enqueue endpoint
  app.post('/api/scheduler/enqueue', async (request, reply) => {
    const body = z.object({
      session_id: z.string(),
      prompt: z.string().optional(),
    }).parse(request.body)
    try {
      const job = scheduler.enqueueSession(opCtx, body.session_id, body.prompt)
      reply.code(202)
      return { job }
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  // POST /api/scheduler/enqueue-step — enqueue a single analysis step
  // Auto-finds the cursor step for the given analysis session.
  app.post('/api/scheduler/enqueue-step', async (request, reply) => {
    const { session_id } = z.object({ session_id: z.string() }).parse(request.body)
    const session = getSessionRecord(database.connection, session_id)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    if (session.sessionType !== 'session_analysis') {
      reply.code(400)
      return apiError('validation', 'Session is not an analysis session.')
    }
    const steps = listStepRecordsBySession(database.connection, session_id)
    const cursorStep = steps.find(s => s.stepTypeKey === 'analysis_v2_cursor')
    if (!cursorStep) {
      reply.code(422)
      return apiError('validation', 'Analysis session has no cursor step.')
    }
    try {
      const job = scheduler.enqueueStep(opCtx, session_id, cursorStep.id)
      reply.code(202)
      return { job }
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  app.get('/api/scheduler/stream', async (_request, reply) => {
    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache, no-transform')
    reply.raw.setHeader('connection', 'keep-alive')

    // Send initial snapshot as first event
    const snapshot = scheduler.getSnapshot()
    reply.raw.write(`event: scheduler-snapshot\n`)
    reply.raw.write(`data: ${JSON.stringify({ type: 'scheduler-snapshot', ...snapshot })}\n\n`)

    const unsubscribe = scheduler.subscribe((event: SchedulerEvent) => {
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    // Clean up subscription when client disconnects
    reply.raw.on('close', () => {
      unsubscribe()
    })

    // Keep the connection open; never call reply.raw.end() here —
    // it will be closed by client disconnect or server shutdown.
    await new Promise<void>(resolve => reply.raw.on('close', resolve))
  })

  app.addHook('onClose', async () => {
    database.connection.close()
  })

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    backendDb: ReturnType<typeof openBackendDatabase>
  }
}
