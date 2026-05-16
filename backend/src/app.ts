import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import ScalarApiReference from '@scalar/fastify-api-reference'
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
import { deriveContextEntries, deriveTranscriptEntries } from './domain/selectors.js'
import { buildSessionTraceBundle, sessionTraceBundleSchema, type SessionTraceBundle } from './domain/trace.js'
import { openBackendDatabase } from './persistence/db.js'
import {
  deleteLmConnection,
  deleteMcpServerProfile,
  deleteModelConfig,
  deleteSessionRecord,
  getSessionRecord,
  updateSessionRecord,
  listLmConnections,
  listMcpServerProfiles,
  listModelConfigs,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  listRoundRecordsBySession,
  listSessionRecords,
  listTurnRecordsBySession,
  upsertLmConnection,
  upsertMcpServerProfile,
  upsertModelConfig,
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
import { importTraceBundle } from './runtime/traceImport.js'
import { runSessionInitialization } from './runtime/sessionInit.js'
import { resolveHierarchicalId } from './runtime/hierarchicalLookup.js'
import { buildOpenApiDocument } from './openapi.js'

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

  await app.register(ScalarApiReference, {
    routePrefix: '/reference',
    configuration: {
      pageTitle: 'mcpscope API Reference',
      title: 'mcpscope API',
      theme: 'purple',
      content: () => buildOpenApiDocument(config.appVersion ?? 'dev'),
    },
  })

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
    let session
    try {
      session = createSession(database, input)
    } catch (error) {
      if (error instanceof SessionIdInputError) {
        reply.code(400)
        return apiError('validation', error.message, { code: 'invalid_session_id' })
      }
      if (error instanceof SessionIdConflictError) {
        reply.code(409)
        return apiError('validation', error.message, { code: 'duplicate_session_id' })
      }
      if (error instanceof SessionIdGenerationError) {
        reply.code(409)
        return apiError('validation', error.message, { code: 'session_id_generation_failed' })
      }
      throw error
    }
    reply.code(201)
    return { session }
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
      sessions: listSessionRecords(database.connection),
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
    const deleted = deleteMcpServerProfile(database.connection, mcpProfileId)
    if (!deleted) {
      reply.code(404)
      return apiError('not_found', 'MCP profile not found')
    }
    reply.code(204)
    return null
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

  app.get('/api/sessions/:sessionId/transcript', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    const parts = listPartRecordsBySession(database.connection, sessionId)
    return {
      session,
      transcript: deriveTranscriptEntries(parts),
    }
  })

  app.get('/api/sessions/:sessionId/context', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    const parts = listPartRecordsBySession(database.connection, sessionId)
    return {
      session,
      context: deriveContextEntries(parts),
    }
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
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }

    const result = session.mcpProfileSnapshot
      ? await createToolEnabledTurn(database, dependencies.lmStudioGateway, dependencies.mcpGateway, {
          sessionId,
          userContent: input.userContent,
          maxToolRounds: config.maxToolRounds,
        })
      : await createModelOnlyTurn(database, dependencies.lmStudioGateway, {
          sessionId,
          userContent: input.userContent,
        })

    reply.code(201)
    return result
  })

  app.post('/api/sessions/:sessionId/initialize', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
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
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
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

    // Track the turn ID as soon as it's emitted so error reporting can reference it.
    let activeTurnId: string | null = null
    const trackingEmitEvent = (event: { type: string; [key: string]: unknown }) => {
      if (event.type === 'turn-started' && typeof event.turn === 'object' && event.turn !== null) {
        activeTurnId = (event.turn as { id?: string }).id ?? null
      }
      emitEvent(event)
    }

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
          },
          trackingEmitEvent,
        )
      } else {
        await createModelOnlyTurn(
          database,
          dependencies.lmStudioGateway,
          {
            sessionId,
            userContent: input.userContent,
          },
          trackingEmitEvent,
        )
      }
    } catch (error) {
      app.log.error({ sessionId, turnId: activeTurnId, err: error instanceof Error ? error.message : String(error) }, 'Streaming turn failed')
      emitEvent({
        type: 'turn-failed',
        errorType: 'internal',
        turnId: activeTurnId,
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
