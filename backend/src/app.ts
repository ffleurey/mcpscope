import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import Fastify from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { BackendConfig } from './config.js'
import {
  createSessionInputSchema,
  createTurnInputSchema,
  healthResponseSchema,
} from './domain/apiSchemas.js'
import {
  lmStudioConnectionSchema,
  mcpServerProfileSchema,
  modelConfigSchema,
} from './domain/configuration.js'
import { getDomainModelSummary } from './domain/model.js'
import type { TurnRecord } from './domain/model.js'
import { deriveContextEntries, deriveTranscriptEntries } from './domain/selectors.js'
import { buildSessionTraceBundle, sessionTraceBundleSchema, type SessionTraceBundle } from './domain/trace.js'
import { openBackendDatabase } from './persistence/db.js'
import {
  deleteLmConnection,
  deleteMcpServerProfile,
  deleteModelConfig,
  deleteSessionRecord,
  findActiveSession,
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
  listSessionSummaries,
  listTurnRecordsBySession,
  getNextTurnSequenceNumber,
  insertTurnRecord,
  upsertLmConnection,
  upsertMcpServerProfile,
  upsertModelConfig,
  updateTurnRecord,
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
import {
  createModelOnlyTurn,
  createSession,
  SessionIdConflictError,
  SessionIdGenerationError,
  SessionIdInputError,
  type LmStudioGateway,
} from './runtime/modelTurns.js'
import { createToolEnabledTurn, type McpGateway } from './runtime/toolTurns.js'
import { formatTurnId } from './domain/hierarchicalIds.js'
import { importTraceBundle } from './runtime/traceImport.js'
import { runSessionInitialization } from './runtime/sessionInit.js'
import { resolveHierarchicalId } from './runtime/hierarchicalLookup.js'

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

  function anotherSessionActiveError(active: ActiveSessionInfo) {
    return {
      api_version: 1,
      error: {
        code: 'another_session_active',
        message: 'Another session is currently active. Nothing was started.',
        active_session: { id: active.id, state: active.state },
      },
    }
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

  app.post('/api/sessions', async (request, reply) => {
    const input = createSessionInputSchema.parse(request.body)

    type CreateResult =
      | { kind: 'blocked'; active: ActiveSessionInfo }
      | { kind: 'created'; session: SessionRecord }
      | { kind: 'id_input_error'; error: SessionIdInputError }
      | { kind: 'id_conflict_error'; error: SessionIdConflictError }
      | { kind: 'id_generation_error'; error: SessionIdGenerationError }

    const result: CreateResult = database.connection.transaction((): CreateResult => {
      const active = findActiveSession(database.connection)
      if (active) return { kind: 'blocked', active }
      try {
        const session = createSession(database, input)
        return { kind: 'created', session }
      } catch (error) {
        if (error instanceof SessionIdInputError) return { kind: 'id_input_error', error }
        if (error instanceof SessionIdConflictError) return { kind: 'id_conflict_error', error }
        if (error instanceof SessionIdGenerationError) return { kind: 'id_generation_error', error }
        throw error
      }
    })()

    if (result.kind === 'blocked') {
      reply.code(409)
      return anotherSessionActiveError(result.active)
    }
    if (result.kind === 'id_input_error') {
      reply.code(400)
      return apiError('validation', result.error.message, { code: 'invalid_session_id' })
    }
    if (result.kind === 'id_conflict_error') {
      reply.code(409)
      return apiError('validation', result.error.message, { code: 'duplicate_session_id' })
    }
    if (result.kind === 'id_generation_error') {
      reply.code(409)
      return apiError('validation', result.error.message, { code: 'session_id_generation_failed' })
    }
    reply.code(201)
    return { session: result.session }
  })

  app.post('/api/sessions/from-defaults', async (request, reply) => {
    const { title, sessionId, compactionStrategy } = z.object({
      title: z.string().min(1).max(200).optional(),
      sessionId: z.string().optional(),
      compactionStrategy: z.enum(['none', 'strip-reasoning']).optional(),
    }).parse(request.body)

    type FromDefaultsResult =
      | { kind: 'blocked'; active: ActiveSessionInfo }
      | { kind: 'validation_error'; status: number; body: ReturnType<typeof apiError> }
      | { kind: 'id_input_error'; error: SessionIdInputError }
      | { kind: 'id_conflict_error'; error: SessionIdConflictError }
      | { kind: 'id_generation_error'; error: SessionIdGenerationError }
      | { kind: 'created'; session: SessionRecord; modelConfigId: string; modelConfigName: string; mcpProfileSnapshot: typeof mcpSnapshotRef }

    // Use a placeholder to capture mcp snapshot outside the transaction return type
    let mcpSnapshotRef: {
      id: string; name: string; url: string
      transport: 'streamable-http' | 'sse'
      authType: 'bearer' | null; authValue: string | null
      createdAt: number; updatedAt: number
    } | null = null

    const result: FromDefaultsResult = database.connection.transaction((): FromDefaultsResult => {
      const active = findActiveSession(database.connection)
      if (active) return { kind: 'blocked', active }

      const defaults = getSessionCreationDefaults(database.connection)

      if (!defaults.defaultModelConfigId) {
        return {
          kind: 'validation_error',
          status: 422,
          body: apiError('validation', 'No default model config is configured for new sessions.', {
            code: 'default_model_not_configured',
          }),
        }
      }

      const modelConfigs = listModelConfigs(database.connection)
      const modelConfig = modelConfigs.find(c => c.id === defaults.defaultModelConfigId)
      if (!modelConfig) {
        return {
          kind: 'validation_error',
          status: 422,
          body: apiError('validation', `Default model config "${defaults.defaultModelConfigId}" no longer exists.`, {
            code: 'default_model_config_not_found',
          }),
        }
      }

      const lmConnections = listLmConnections(database.connection)
      const lmConnection = lmConnections.find(c => c.id === modelConfig.connectionId)
      if (!lmConnection) {
        return {
          kind: 'validation_error',
          status: 422,
          body: apiError('validation', `LM connection "${modelConfig.connectionId}" referenced by the default model config no longer exists.`, {
            code: 'default_lm_connection_not_found',
          }),
        }
      }

      let mcpProfileSnapshot: typeof mcpSnapshotRef = null
      if (defaults.defaultMcpProfileId) {
        const mcpProfiles = listMcpServerProfiles(database.connection)
        const mcpProfile = mcpProfiles.find(p => p.id === defaults.defaultMcpProfileId)
        if (!mcpProfile) {
          return {
            kind: 'validation_error',
            status: 422,
            body: apiError('validation', `Default MCP profile "${defaults.defaultMcpProfileId}" no longer exists.`, {
              code: 'default_mcp_profile_not_found',
            }),
          }
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
        const session = createSession(database, {
          sessionId,
          title,
          modelProfileSnapshot,
          mcpProfileSnapshot,
          compactionStrategy: compactionStrategy ?? 'strip-reasoning',
        })
        mcpSnapshotRef = mcpProfileSnapshot
        return { kind: 'created', session, modelConfigId: modelConfig.id, modelConfigName: modelConfig.name, mcpProfileSnapshot }
      } catch (error) {
        if (error instanceof SessionIdInputError) return { kind: 'id_input_error', error }
        if (error instanceof SessionIdConflictError) return { kind: 'id_conflict_error', error }
        if (error instanceof SessionIdGenerationError) return { kind: 'id_generation_error', error }
        throw error
      }
    })()

    if (result.kind === 'blocked') {
      reply.code(409)
      return anotherSessionActiveError(result.active)
    }
    if (result.kind === 'validation_error') {
      reply.code(result.status)
      return result.body
    }
    if (result.kind === 'id_input_error') {
      reply.code(400)
      return apiError('validation', result.error.message, { code: 'invalid_session_id' })
    }
    if (result.kind === 'id_conflict_error') {
      reply.code(409)
      return apiError('validation', result.error.message, { code: 'duplicate_session_id' })
    }
    if (result.kind === 'id_generation_error') {
      reply.code(409)
      return apiError('validation', result.error.message, { code: 'session_id_generation_failed' })
    }

    const { session, modelConfigId, modelConfigName, mcpProfileSnapshot } = result

    // Fire off initialization in the background (detached — caller polls via /status)
    const sessionId_ = session.id
    runSessionInitialization(database, dependencies.lmStudioGateway, dependencies.mcpGateway, sessionId_, () => {}).catch((err: unknown) => {
      app.log.error({ sessionId: sessionId_, err: err instanceof Error ? err.message : String(err) }, 'Detached session initialization failed')
      const s = getSessionRecord(database.connection, sessionId_)
      if (s && (s.initStatus === 'initializing' || s.initStatus === 'pending')) {
        s.initStatus = 'error'
        s.updatedAt = Date.now()
        updateSessionRecord(database.connection, s)
      }
    })

    reply.code(201)
    return {
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        initStatus: session.initStatus,
        model: { id: modelConfigId, name: modelConfigName },
        mcp: mcpProfileSnapshot ? { id: mcpProfileSnapshot.id, name: mcpProfileSnapshot.name } : null,
        compactionStrategy: session.compactionStrategy,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    }
  })

  app.get('/api/sessions/:sessionId/status', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found', { code: 'session_not_found' })
    }

    const turns = listTurnRecordsBySession(database.connection, sessionId)
    const activeTurn = [...turns]
      .reverse()
      .find(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
      ?? null
    const latestTurn = turns.at(-1) ?? null

    let state: 'initializing' | 'ready' | 'running' | 'error'
    if (session.initStatus === 'error' || session.status === 'error' || latestTurn?.status === 'error') {
      state = 'error'
    } else if (session.initStatus === 'pending' || session.initStatus === 'initializing') {
      state = 'initializing'
    } else if (activeTurn) {
      state = 'running'
    } else {
      state = 'ready'
    }

    const relevantTurn = state === 'running'
      ? activeTurn
      : state === 'error'
        ? latestTurn
        : null

    return {
      session: { id: session.id, state },
      activeTurn: relevantTurn
        ? {
            id: relevantTurn.id,
            status: relevantTurn.status,
          }
        : null,
    }
  })

  app.post('/api/sessions/:sessionId/turns/start', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const { userContent } = z.object({ userContent: z.string().min(1) }).parse(request.body)

    const reserveTurn = database.connection.transaction(() => {
      const session = getSessionRecord(database.connection, sessionId)
      if (!session) {
        return { kind: 'not_found' } as const
      }

      if (session.initStatus !== 'ready') {
        return { kind: 'not_initialized' } as const
      }

      const active = findActiveSession(database.connection, sessionId)
      if (active) {
        return { kind: 'another_session_active', active } as const
      }

      const hasActiveTurn = listTurnRecordsBySession(database.connection, sessionId)
        .some(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
      if (hasActiveTurn) {
        return { kind: 'turn_in_progress' } as const
      }

      const createdAt = Date.now()
      const nextSeq = getNextTurnSequenceNumber(database.connection, sessionId)
      const turn: TurnRecord = {
        id: formatTurnId(sessionId, nextSeq),
        sessionId,
        sequenceNumber: nextSeq,
        status: 'streaming',
        createdAt,
        completedAt: null,
        outcome: null,
        usage: {
          promptTokens: null,
          completionTokens: null,
          reasoningTokens: null,
          totalTokens: null,
        },
        contextTokensAtTurnEnd: null,
        contextTokensAfterCompaction: null,
        compactionApplied: null,
        compactionTokensRemoved: null,
      }

      insertTurnRecord(database.connection, turn)
      return { kind: 'reserved', session, turn } as const
    })

    const reservation = reserveTurn()
    if (reservation.kind === 'not_found') {
      reply.code(404)
      return apiError('not_found', 'Session not found', { code: 'session_not_found' })
    }

    if (reservation.kind === 'not_initialized') {
      reply.code(409)
      return apiError('validation', 'Session is still initializing or has not reached a ready state. Nothing was queued.', {
        code: 'session_not_initialized',
      })
    }

    if (reservation.kind === 'another_session_active') {
      reply.code(409)
      return anotherSessionActiveError(reservation.active)
    }

    if (reservation.kind === 'turn_in_progress') {
      reply.code(409)
      return apiError('validation', 'A turn is already in progress for this session. Nothing was queued.', {
        code: 'turn_in_progress',
      })
    }

    const { session, turn } = reservation
    const runTurn = session.mcpProfileSnapshot
      ? createToolEnabledTurn(database, dependencies.lmStudioGateway, dependencies.mcpGateway, {
          sessionId,
          userContent,
          maxToolRounds: config.maxToolRounds,
          reservedTurn: turn,
        })
      : createModelOnlyTurn(database, dependencies.lmStudioGateway, {
          sessionId,
          userContent,
          reservedTurn: turn,
        })

    runTurn.catch((err: unknown) => {
      app.log.error({ sessionId, turnId: turn.id, err: err instanceof Error ? err.message : String(err) }, 'Detached turn failed')
      const failedTurn = listTurnRecordsBySession(database.connection, sessionId).find(existing => existing.id === turn.id)
      if (failedTurn && (failedTurn.status === 'draft' || failedTurn.status === 'streaming' || failedTurn.status === 'awaiting-tools')) {
        failedTurn.status = 'error'
        failedTurn.completedAt = Date.now()
        failedTurn.outcome = failedTurn.outcome ?? 'detached-failure'
        updateTurnRecord(database.connection, failedTurn)
      }
    })

    reply.code(202)
    return {
      sessionId,
      turn: { id: turn.id, status: 'running' },
    }
  })

  app.get('/api/lookup/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { mode } = z.object({ mode: z.enum(['summary', 'full']).optional() }).parse(request.query)

    const resolved = resolveHierarchicalId(database.connection, id, mode ?? 'summary')
    if (resolved.status === 'invalid') {
      reply.code(400)
      return apiError('validation', resolved.message, { code: 'invalid_hierarchical_id' })
    }
    if (resolved.status === 'not_found') {
      reply.code(404)
      return apiError('not_found', resolved.message, { code: 'hierarchical_id_not_found' })
    }
    return resolved.payload
  })

  app.get('/api/sessions', async () => {
    return {
      sessions: listSessionSummaries(database.connection),
    }
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
      turns,
      rounds,
      parts,
      rawExchanges,
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
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const input = createTurnInputSchema.parse(request.body)

    // Reserve the turn atomically before any async work. Without this, the global
    // lock check and the actual turn insertion would be non-atomic: another request
    // could slip through the lock check during the async gap between the check and
    // the turn being written to the DB by createModelOnlyTurn/createToolEnabledTurn.
    type ReserveResult =
      | { kind: 'not_found' }
      | { kind: 'another_session_active'; active: ActiveSessionInfo }
      | { kind: 'turn_in_progress' }
      | { kind: 'reserved'; session: SessionRecord; turn: TurnRecord }

    const reservation: ReserveResult = database.connection.transaction((): ReserveResult => {
      const session = getSessionRecord(database.connection, sessionId)
      if (!session) return { kind: 'not_found' }

      const active = findActiveSession(database.connection, sessionId)
      if (active) return { kind: 'another_session_active', active }

      const hasActiveTurn = listTurnRecordsBySession(database.connection, sessionId)
        .some(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
      if (hasActiveTurn) return { kind: 'turn_in_progress' }

      const createdAt = Date.now()
      const nextSeq = getNextTurnSequenceNumber(database.connection, sessionId)
      const turn: TurnRecord = {
        id: formatTurnId(sessionId, nextSeq),
        sessionId,
        sequenceNumber: nextSeq,
        status: 'streaming',
        createdAt,
        completedAt: null,
        outcome: null,
        usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
        contextTokensAtTurnEnd: null,
        contextTokensAfterCompaction: null,
        compactionApplied: null,
        compactionTokensRemoved: null,
      }
      insertTurnRecord(database.connection, turn)
      return { kind: 'reserved', session, turn }
    })()

    if (reservation.kind === 'not_found') {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    if (reservation.kind === 'another_session_active') {
      reply.code(409)
      return anotherSessionActiveError(reservation.active)
    }
    if (reservation.kind === 'turn_in_progress') {
      reply.code(409)
      return apiError('validation', 'A turn is already in progress for this session.', { code: 'turn_in_progress' })
    }

    const result = reservation.session.mcpProfileSnapshot
      ? await createToolEnabledTurn(database, dependencies.lmStudioGateway, dependencies.mcpGateway, {
          sessionId,
          userContent: input.userContent,
          maxToolRounds: config.maxToolRounds,
          reservedTurn: reservation.turn,
        })
      : await createModelOnlyTurn(database, dependencies.lmStudioGateway, {
          sessionId,
          userContent: input.userContent,
          reservedTurn: reservation.turn,
        })

    reply.code(201)
    return result
  })

  app.post('/api/sessions/:sessionId/initialize', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)

    const prereq = database.connection.transaction(() => {
      const session = getSessionRecord(database.connection, sessionId)
      if (!session) return { kind: 'not_found' } as const
      const active = findActiveSession(database.connection, sessionId)
      if (active) return { kind: 'another_session_active', active } as const
      return { kind: 'ok' } as const
    })()

    if (prereq.kind === 'not_found') {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    if (prereq.kind === 'another_session_active') {
      reply.code(409)
      return anotherSessionActiveError(prereq.active)
    }

    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache, no-transform')
    reply.raw.setHeader('connection', 'keep-alive')

    const emitEvent = (event: { type: string; [key: string]: unknown }) => {
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    try {
      await runSessionInitialization(
        database,
        dependencies.lmStudioGateway,
        dependencies.mcpGateway,
        sessionId,
        emitEvent,
      )
    } catch (error) {
      app.log.error({ sessionId, err: error instanceof Error ? error.message : String(error) }, 'Session initialization failed')
      emitEvent({
        type: 'prelude-failed',
        errorType: 'internal',
        message: error instanceof Error ? error.message : 'Unknown initialization failure',
      })
    } finally {
      reply.raw.end()
    }
  })

  app.post('/api/sessions/:sessionId/turns/stream', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const input = createTurnInputSchema.parse(request.body)

    // Reserve the turn atomically (global lock check + same-session turn_in_progress check +
    // turn insertion) before reply.hijack() and before any async work. This is critical:
    // createModelOnlyTurn/createToolEnabledTurn do async work (token preflight) before they
    // write the turn record to the DB. Without pre-inserting here, the global lock would have
    // no DB record to find during the async gap, allowing concurrent session creation or other
    // turn starts to slip through.
    type ReserveResult =
      | { kind: 'not_found' }
      | { kind: 'another_session_active'; active: ActiveSessionInfo }
      | { kind: 'turn_in_progress' }
      | { kind: 'reserved'; session: SessionRecord; turn: TurnRecord }

    const reservation: ReserveResult = database.connection.transaction((): ReserveResult => {
      const session = getSessionRecord(database.connection, sessionId)
      if (!session) return { kind: 'not_found' }

      const active = findActiveSession(database.connection, sessionId)
      if (active) return { kind: 'another_session_active', active }

      const hasActiveTurn = listTurnRecordsBySession(database.connection, sessionId)
        .some(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
      if (hasActiveTurn) return { kind: 'turn_in_progress' }

      const createdAt = Date.now()
      const nextSeq = getNextTurnSequenceNumber(database.connection, sessionId)
      const turn: TurnRecord = {
        id: formatTurnId(sessionId, nextSeq),
        sessionId,
        sequenceNumber: nextSeq,
        status: 'streaming',
        createdAt,
        completedAt: null,
        outcome: null,
        usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
        contextTokensAtTurnEnd: null,
        contextTokensAfterCompaction: null,
        compactionApplied: null,
        compactionTokensRemoved: null,
      }
      insertTurnRecord(database.connection, turn)
      return { kind: 'reserved', session, turn }
    })()

    if (reservation.kind === 'not_found') {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    if (reservation.kind === 'another_session_active') {
      reply.code(409)
      return anotherSessionActiveError(reservation.active)
    }
    if (reservation.kind === 'turn_in_progress') {
      reply.code(409)
      return apiError('validation', 'A turn is already in progress for this session.', { code: 'turn_in_progress' })
    }

    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache, no-transform')
    reply.raw.setHeader('connection', 'keep-alive')

    const emitEvent = (event: { type: string; [key: string]: unknown }) => {
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    const { session, turn } = reservation
    try {
      if (session.mcpProfileSnapshot) {
        await createToolEnabledTurn(
          database,
          dependencies.lmStudioGateway,
          dependencies.mcpGateway,
          {
            sessionId,
            userContent: input.userContent,
            maxToolRounds: config.maxToolRounds,
            reservedTurn: turn,
          },
          emitEvent,
        )
      } else {
        await createModelOnlyTurn(
          database,
          dependencies.lmStudioGateway,
          {
            sessionId,
            userContent: input.userContent,
            reservedTurn: turn,
          },
          emitEvent,
        )
      }
    } catch (error) {
      app.log.error({ sessionId, turnId: turn.id, err: error instanceof Error ? error.message : String(error) }, 'Streaming turn failed')
      emitEvent({
        type: 'turn-failed',
        errorType: 'internal',
        turnId: turn.id,
        message: error instanceof Error ? error.message : 'Unknown streaming failure',
      })
    } finally {
      reply.raw.end()
    }
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
