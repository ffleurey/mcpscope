import cors from '@fastify/cors'
import Fastify from 'fastify'
import { z } from 'zod'
import type { BackendConfig } from './config.js'
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
import { createChatCompletion, getLoadedContextLength, probePromptTokens, probePromptTokensDetailed, streamChatCompletion } from './services/lmstudio/client.js'
import { callMcpTool, initializeMcpSession, listMcpTools } from './services/mcp/httpClient.js'
import { createModelOnlyTurn, createSession, type LmStudioGateway } from './runtime/modelTurns.js'
import { createToolEnabledTurn, type McpGateway } from './runtime/toolTurns.js'
import { importTraceBundle } from './runtime/traceImport.js'
import { runSessionInitialization } from './runtime/sessionInit.js'

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('ai-clientapp-backend'),
  sqlitePath: z.string(),
})

const modelProfileSnapshotInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectionBaseUrl: z.string().url(),
  apiKey: z.string().nullable().default(null),
  modelKey: z.string(),
  modelDisplayName: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  reasoning: z.enum(['on', 'off']).nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

const mcpProfileSnapshotInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  transport: z.literal('streamable-http'),
  authType: z.enum(['none', 'bearer', 'basic']).nullable().default(null),
  authValue: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

const createSessionInputSchema = z.object({
  title: z.string().optional(),
  modelProfileSnapshot: modelProfileSnapshotInputSchema,
  mcpProfileSnapshot: mcpProfileSnapshotInputSchema.nullable().optional(),
  compactionStrategy: z.enum(['none', 'strip-reasoning']).optional(),
})

const createTurnInputSchema = z.object({
  userContent: z.string().min(1),
})

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
  })

  await app.register(cors, {
    origin: config.corsOrigin,
  })

  const database = openBackendDatabase(config.sqlitePath)
  app.decorate('backendDb', database)

  app.get('/api/health', async () => {
    return healthResponseSchema.parse({
      status: 'ok',
      service: 'ai-clientapp-backend',
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
    const session = createSession(database, input)
    reply.code(201)
    return { session }
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
      return { error: 'Session not found' }
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
      return { error: 'Session not found' }
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
      return { error: 'Connection ID mismatch' }
    }
    upsertLmConnection(database.connection, record)
    return { lmConnection: record }
  })

  app.delete('/api/lm-connections/:connectionId', async (request, reply) => {
    const { connectionId } = z.object({ connectionId: z.string() }).parse(request.params)
    const deleted = deleteLmConnection(database.connection, connectionId)
    if (!deleted) {
      reply.code(404)
      return { error: 'LM connection not found' }
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
      return { error: 'Model config ID mismatch' }
    }
    upsertModelConfig(database.connection, record)
    return { modelConfig: record }
  })

  app.delete('/api/model-configs/:modelConfigId', async (request, reply) => {
    const { modelConfigId } = z.object({ modelConfigId: z.string() }).parse(request.params)
    const deleted = deleteModelConfig(database.connection, modelConfigId)
    if (!deleted) {
      reply.code(404)
      return { error: 'Model config not found' }
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
      return { error: 'MCP profile ID mismatch' }
    }
    upsertMcpServerProfile(database.connection, record)
    return { mcpProfile: record }
  })

  app.delete('/api/mcp-profiles/:mcpProfileId', async (request, reply) => {
    const { mcpProfileId } = z.object({ mcpProfileId: z.string() }).parse(request.params)
    const deleted = deleteMcpServerProfile(database.connection, mcpProfileId)
    if (!deleted) {
      reply.code(404)
      return { error: 'MCP profile not found' }
    }
    reply.code(204)
    return null
  })

  app.get('/api/sessions/:sessionId/transcript', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return { error: 'Session not found' }
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
      return { error: 'Session not found' }
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
      return { error: 'Session not found' }
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
      return { error: 'Session not found' }
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
      return { error: 'Session not found' }
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
      emitEvent({
        type: 'prelude-failed',
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
      return { error: 'Session not found' }
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
      emitEvent({
        type: 'turn-failed',
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
