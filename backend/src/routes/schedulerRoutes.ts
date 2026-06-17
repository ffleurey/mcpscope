import { z } from 'zod'
import { apiError } from '../errors.js'
import { getSessionRecord } from '../persistence/repository.js'
import type { SchedulerEvent } from '../runtime/schedulerTypes.js'
import type { RouteDeps } from './types.js'

export function registerSchedulerRoutes({ app, database, scheduler, opCtx, handleOperationError }: RouteDeps): void {
  app.get('/api/scheduler/snapshot', async () => scheduler.getSnapshot())

  app.post('/api/scheduler/pause', async () => {
    scheduler.pause()
    return { ok: true, controlState: 'paused' }
  })

  app.post('/api/scheduler/resume', async () => {
    scheduler.resume()
    return { ok: true, controlState: 'running' }
  })

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

  app.post('/api/scheduler/enqueue', async (request, reply) => {
    const body = z.object({ session_id: z.string(), prompt: z.string().optional() }).parse(request.body)
    try {
      const job = scheduler.enqueueSession(opCtx, body.session_id, body.prompt)
      reply.code(202)
      return { job }
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

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
    const analysisState = session.analysisState as { phase?: string } | null
    if (analysisState?.phase === 'complete' || analysisState?.phase === 'error') {
      reply.code(422)
      return apiError('validation', `Analysis session is in terminal phase '${analysisState?.phase}'.`)
    }
    try {
      const job = scheduler.enqueueStep(opCtx, session_id)
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

    const snapshot = scheduler.getSnapshot()
    reply.raw.write('event: scheduler-snapshot\n')
    reply.raw.write(`data: ${JSON.stringify({ type: 'scheduler-snapshot', ...snapshot })}\n\n`)

    const unsubscribe = scheduler.subscribe((event: SchedulerEvent) => {
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    reply.raw.on('close', () => {
      unsubscribe()
    })

    await new Promise<void>(resolve => reply.raw.on('close', resolve))
  })
}