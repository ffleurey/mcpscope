import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import Fastify, { type FastifyReply } from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { BackendConfig } from './config.js'
import { openBackendDatabase } from './persistence/db.js'
import {
  recoverInterruptedState,
  listTurnRecordsBySession,
  type ActiveSessionInfo,
} from './persistence/repository.js'
import {
  createChatCompletion,
  getLoadedContextLength,
  probePromptTokens,
  probePromptTokensDetailed,
  streamChatCompletion,
} from './services/lmstudio/client.js'
import { callMcpTool, initializeMcpSession, listMcpTools } from './services/mcp/httpClient.js'
import { apiError } from './errors.js'
import type { LmStudioGateway } from './runtime/modelTurns.js'
import type { McpGateway } from './runtime/toolTurns.js'
import { registerMcpTransport } from './mcp/index.js'
import {
  OperationError,
  operationErrorResponse,
  operationErrorToHttpStatus,
  type OperationContext,
} from './operations/index.js'
import { ExecutionScheduler } from './runtime/scheduler.js'
import type { SchedulerEvent } from './runtime/schedulerTypes.js'
import { registerConfigurationRoutes } from './routes/configurationRoutes.js'
import { registerSchedulerRoutes } from './routes/schedulerRoutes.js'
import { registerSessionRoutes } from './routes/sessionRoutes.js'
import { registerSystemRoutes } from './routes/systemRoutes.js'
import { registerTraceRoutes } from './routes/traceRoutes.js'

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

  type SchedulerExecutionPayload = Extract<SchedulerEvent, { type: 'scheduler-execution-event' }>['event']
  type SsePayload = { type: string; [key: string]: unknown }

  async function relaySchedulerJobStream(
    reply: FastifyReply,
    jobId: string,
    options: {
      shouldCloseOnExecutionEvent: (event: SchedulerExecutionPayload) => boolean
      failureEvent: (message: string) => SsePayload
    },
  ): Promise<void> {
    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache, no-transform')
    reply.raw.setHeader('connection', 'keep-alive')

    const emitSseEvent = (event: SsePayload) => {
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    const emitFailure = (message: string) => {
      emitSseEvent(options.failureEvent(message))
    }

    let closed = false
    let unsubscribe: (() => void) | null = null

    const finish = () => {
      if (closed) return
      closed = true
      unsubscribe?.()
      reply.raw.end()
    }

    reply.raw.on('close', () => {
      if (!closed) {
        unsubscribe?.()
        closed = true
      }
    })

    unsubscribe = scheduler.subscribe((schedulerEvent: SchedulerEvent) => {
      if (schedulerEvent.type === 'scheduler-execution-event' && schedulerEvent.jobId === jobId) {
        emitSseEvent(schedulerEvent.event as SsePayload)
        if (options.shouldCloseOnExecutionEvent(schedulerEvent.event)) {
          finish()
        }
        return
      }

      if (schedulerEvent.type === 'scheduler-job-failed' && schedulerEvent.job.jobId === jobId) {
        emitFailure(schedulerEvent.job.error ?? 'Job failed')
        finish()
        return
      }

      if (schedulerEvent.type === 'scheduler-job-completed' && schedulerEvent.job.jobId === jobId) {
        finish()
        return
      }

      if (schedulerEvent.type === 'scheduler-job-removed' && schedulerEvent.jobId === jobId) {
        finish()
      }
    })

    const snapshot = scheduler.getSnapshot()
    const stillPresent = snapshot.activeJob?.jobId === jobId
      || snapshot.pendingJobs.some(job => job.jobId === jobId)
    if (!stillPresent && snapshot.lastTerminalJob?.jobId === jobId) {
      if (snapshot.lastTerminalJob.outcome === 'failed') {
        emitFailure(snapshot.lastTerminalJob.error ?? 'Job failed')
      }
      finish()
    }
  }

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

  const routeDeps = {
    app,
    config,
    database,
    scheduler,
    opCtx,
    handleOperationError,
    anotherSessionActiveError,
    toLifecycleState,
    relaySchedulerJobStream,
  }

  registerSystemRoutes(routeDeps)
  registerConfigurationRoutes(routeDeps)
  registerSessionRoutes(routeDeps)
  registerTraceRoutes(routeDeps)
  registerSchedulerRoutes(routeDeps)

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
