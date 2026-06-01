import { z } from 'zod'
import { apiError } from '../errors.js'
import {
  getSessionRecord,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  listRoundRecordsBySession,
  listStepRecordsBySession,
  listTurnRecordsBySession,
} from '../persistence/repository.js'
import { buildSessionTraceBundle, sessionTraceBundleSchema, type SessionTraceBundle } from '../domain/trace.js'
import { deriveContextEntries, deriveTranscriptEntries } from '../domain/selectors.js'
import { importTraceBundle } from '../runtime/traceImport.js'
import { listArtifactsBySession } from '../analysis/artifactRepository.js'
import { createTurnInputSchema } from '../domain/apiSchemas.js'
import { OperationError } from '../operations/index.js'
import type { RouteDeps } from './types.js'

export function registerTraceRoutes({ app, database, scheduler, opCtx, handleOperationError, relaySchedulerJobStream }: RouteDeps): void {
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
    return buildSessionTraceBundle({
      session,
      steps: listStepRecordsBySession(database.connection, sessionId),
      turns,
      rounds,
      parts,
      rawExchanges: listRawExchangeRecordsBySession(database.connection, sessionId),
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
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const input = createTurnInputSchema.parse(request.body)

    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }

    if (session.initStatus === 'pending' || session.initStatus === 'initializing') {
      try {
        const initJob = scheduler.enqueueInit(opCtx, sessionId)
        await scheduler.awaitJob(initJob.jobId)
      } catch (err) {
        if (!(err instanceof OperationError && err.code === 'session_already_initialized')) {
          return handleOperationError(err, reply)
        }
      }
    }

    let job: ReturnType<typeof scheduler.enqueueSession>
    try {
      job = scheduler.enqueueSession(opCtx, sessionId, input.userContent)
    } catch (err) {
      return handleOperationError(err, reply)
    }

    const reservedTurn = listTurnRecordsBySession(database.connection, sessionId)
      .find(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
    const turnId = reservedTurn?.id

    await scheduler.awaitJob(job.jobId)

    const completedTurn = turnId
      ? listTurnRecordsBySession(database.connection, sessionId).find(t => t.id === turnId)
      : null
    if (!completedTurn) {
      reply.code(500)
      return apiError('internal', 'Turn could not be located after execution.')
    }
    const rounds = listRoundRecordsBySession(database.connection, sessionId).filter(r => r.turnId === completedTurn.id)
    const parts = listPartRecordsBySession(database.connection, sessionId).filter(p => p.turnId === completedTurn.id)

    reply.code(201)
    return { turn: completedTurn, round: rounds[0], rounds, parts }
  })

  app.post('/api/sessions/:sessionId/initialize', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }

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

    let job: ReturnType<typeof scheduler.enqueueInit>
    try {
      job = scheduler.enqueueInit(opCtx, sessionId)
    } catch (err) {
      return handleOperationError(err, reply)
    }

    await relaySchedulerJobStream(reply, job.jobId, {
      shouldCloseOnExecutionEvent: event => event.type === 'prelude-complete' || event.type === 'prelude-failed',
      failureEvent: message => ({ type: 'prelude-failed', message }),
    })
  })

  app.post('/api/sessions/:sessionId/turns/stream', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const input = createTurnInputSchema.parse(request.body)

    let job: Awaited<ReturnType<typeof scheduler.enqueueSession>>
    try {
      job = scheduler.enqueueSession(opCtx, sessionId, input.userContent)
    } catch (err) {
      return handleOperationError(err, reply)
    }

    await relaySchedulerJobStream(reply, job.jobId, {
      shouldCloseOnExecutionEvent: event => event.type === 'turn-committed' || event.type === 'turn-failed',
      failureEvent: message => ({ type: 'turn-failed', turnId: null, message }),
    })
  })
}