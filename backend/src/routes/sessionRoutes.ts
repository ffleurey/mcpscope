import { z } from 'zod'
import { apiError } from '../errors.js'
import {
  deleteSessionRecord,
  getSessionRecord,
  listAllSessionSummaries,
  listChildSessionSummaries,
  listStepRecordsBySession,
  listTurnRecordsBySession,
  updateSessionRecord,
} from '../persistence/repository.js'
import {
  createOperation,
  inspectOperation,
  listOperation,
  statusOperation,
} from '../operations/index.js'
import {
  createExplicitOperation,
  launchAnalysisSessionOperation,
  launchPrimarySessionOperation,
} from '../operations/internal.js'
import { buildAnalysisSystemPrompt, normalizeAnalysisGoal } from '../analysis/systemPrompt.js'
import type { RouteDeps } from './types.js'

export function registerSessionRoutes(deps: RouteDeps): void {
  const { app, database, scheduler, opCtx, handleOperationError, toLifecycleState } = deps

  app.post('/api/sessions', async (request, reply) => {
    try {
      const result = await createExplicitOperation.execute(opCtx, request.body)
      reply.code(201)
      return result
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

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
      const result = await launchPrimarySessionOperation.execute(opCtx, request.body)
      reply.code(201)
      return result
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  app.post('/api/session-constructors/session-analysis', async (request, reply) => {
    try {
      const result = await launchAnalysisSessionOperation.execute(opCtx, request.body)
      reply.code(201)
      return result
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  app.get('/api/analysis/system-prompt-default', async (request) => {
    const { analysis_goal, additional_instructions } = z.object({
      analysis_goal: z.string().optional(),
      additional_instructions: z.string().optional(),
    }).parse(request.query)

    return {
      systemPrompt: additional_instructions === undefined
        ? buildAnalysisSystemPrompt({ analysisGoal: normalizeAnalysisGoal(analysis_goal) })
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

  app.post('/api/sessions/:sessionId/turns/start', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const { userContent } = z.object({ userContent: z.string().min(1) }).parse(request.body)
    try {
      const job = scheduler.enqueueSession(opCtx, sessionId, userContent)
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

  app.get('/api/lookup/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { mode } = z.object({ mode: z.enum(['summary', 'full']).optional() }).parse(request.query)
    try {
      return await inspectOperation.execute(opCtx, { id, short: (mode ?? 'full') === 'summary' })
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  app.get('/api/sessions', async (request) => {
    const { include_children } = z.object({ include_children: z.enum(['true', 'false']).optional() }).parse(request.query)
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

  app.post('/api/sessions/:sessionId/analyze', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    try {
      const body = z.object({}).passthrough().parse(request.body)
      const result = await launchAnalysisSessionOperation.execute(opCtx, { ...body, target_session_id: sessionId })
      reply.code(201)
      return result
    } catch (err) {
      return handleOperationError(err, reply)
    }
  })

  app.post('/api/sessions/:sessionId/execute', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const { single_step } = z.object({ single_step: z.string().optional() }).parse(request.query)
    const isSingleStep = single_step === 'true' || single_step === '1'

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
        const cursorStep = listStepRecordsBySession(database.connection, sessionId)
          .find(s => s.stepTypeKey === 'analysis_v2_cursor')
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

    await deps.relaySchedulerJobStream(reply, job.jobId, {
      shouldCloseOnExecutionEvent: event => event.type === 'analysis-complete' || event.type === 'analysis-failed',
      failureEvent: message => ({ type: 'analysis-failed', message }),
    })
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
}