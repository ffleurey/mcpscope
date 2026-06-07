import { z } from 'zod'
import { apiError } from '../errors.js'
import {
  deleteSessionRecord,
  getSessionRecord,
  listAllSessionSummaries,
  listChildSessionSummaries,
  listPartRecordsBySession,
  listStepRecordsBySession,
  listTurnRecordsBySession,
  updatePartRecord,
  updateSessionAnalysisState,
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
import {
  getAnalysisWorkflowKindFromSteps,
  getLatestAnalysisDiagnosticSummaryForSession,
  getRetryPhaseForFailedAnalysisStep,
} from '../analysis/analysisSessionPresentation.js'

function buildSessionSummaryPayload(
  deps: Pick<RouteDeps, 'database' | 'toLifecycleState'>,
  summary: {
    id: string
    title: string
    status: string
    initStatus: string
    sessionType: string
    parentKind: string | null
    parentId: string | null
    createdAt: number
    updatedAt: number
    isContextExhausted: boolean
    loadedContextLength: number | null
    compactionStrategy: string
    modelProfileSnapshot: { name: string }
    mcpProfileSnapshots: { name: string }[]
  },
) {
  const steps = listStepRecordsBySession(deps.database.connection, summary.id)
  const workflowKind = summary.sessionType === 'session_analysis'
    ? getAnalysisWorkflowKindFromSteps(steps, deps.database.connection, summary.id)
    : null
  const workflowPhase = summary.sessionType === 'session_analysis'
    ? (() => {
        const sessionAnalysis = getSessionRecord(deps.database.connection, summary.id)
        const analysisState = sessionAnalysis?.analysisState as { phase?: string } | null
        return analysisState?.phase ?? null
      })()
    : null
  const latestError = deps.toLifecycleState(summary) === 'error' && summary.sessionType === 'session_analysis'
    ? getLatestAnalysisDiagnosticSummaryForSession(deps.database.connection, summary.id) ?? undefined
    : undefined

  return {
    id: summary.id,
    title: summary.title,
    status: deps.toLifecycleState(summary),
    init_status: summary.initStatus,
    session_type: summary.sessionType,
    parent_kind: summary.parentKind,
    parent_id: summary.parentId,
    created_at: summary.createdAt,
    updated_at: summary.updatedAt,
    is_context_exhausted: summary.isContextExhausted,
    loaded_context_length: summary.loadedContextLength,
    compaction_strategy: summary.compactionStrategy,
    ...(workflowKind ? { workflow_kind: workflowKind } : {}),
    ...(workflowPhase ? { workflow_phase: workflowPhase } : {}),
    ...(latestError ? { latest_error: latestError } : {}),
    model_profile_snapshot: { name: summary.modelProfileSnapshot.name },
    mcp_profile_snapshots: summary.mcpProfileSnapshots,
  }
}

function resetFailedAnalysisStepForRetry(database: RouteDeps['database'], sessionId: string) {
  const session = getSessionRecord(database.connection, sessionId)
  if (!session) {
    throw new Error('Session not found')
  }

  const analysisState = session.analysisState as Record<string, unknown> | null
  if (!analysisState || analysisState.phase !== 'error') {
    throw new Error('Analysis session is not in a failed state')
  }

  const steps = listStepRecordsBySession(database.connection, sessionId)
  const failedStep = [...steps]
    .reverse()
    .find(step => step.status === 'error')
  if (!failedStep) {
    throw new Error('Analysis session has no failed step to retry')
  }

  const retryPhase = getRetryPhaseForFailedAnalysisStep(failedStep)
  if (!retryPhase) {
    throw new Error(`Failed step ${failedStep.id} is not retryable`)
  }

  const ownedTurnIds = new Set(
    listTurnRecordsBySession(database.connection, sessionId)
      .filter(turn => turn.ownerStepId === failedStep.id)
      .map(turn => turn.id),
  )
  const retryParts = listPartRecordsBySession(database.connection, sessionId)
    .filter(part => part.turnId && ownedTurnIds.has(part.turnId))

  // Reset the walk cursor so hooks replay from the start. Individual hook
  // guards (nextPacketIndex, bootstrapComplete, etc.) prevent re-execution of
  // already-completed work. The failing hook's guard re-matches only for the
  // specific packet/condition that originally failed.
  const updatedAnalysisState = {
    ...analysisState,
    phase: retryPhase,
    walkCursor: 0,
    retry_failed_step_id: failedStep.id,
    retry_requested_at: Date.now(),
  }

  const updatedSession = {
    ...session,
    status: 'ready' as const,
    updatedAt: Date.now(),
  }

  const tx = database.connection.transaction(() => {
    updateSessionAnalysisState(database.connection, sessionId, updatedAnalysisState)
    updateSessionRecord(database.connection, updatedSession)
    for (const part of retryParts) {
      updatePartRecord(database.connection, {
        ...part,
        context: {
          ...part.context,
          state: 'excluded',
        },
        updatedAt: updatedSession.updatedAt,
      })
    }
  })
  tx()

  return {
    failedStepId: failedStep.id,
    retryPhase,
    latestError: getLatestAnalysisDiagnosticSummaryForSession(database.connection, sessionId),
  }
}

export function registerSessionRoutes(deps: RouteDeps): void {
  const { app, database, scheduler, opCtx, handleOperationError } = deps

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
    const { analysis_goal, additional_instructions, workflow_kind } = z.object({
      analysis_goal: z.string().optional(),
      additional_instructions: z.string().optional(),
      workflow_kind: z.string().optional(),
    }).parse(request.query)

    return {
      systemPrompt: additional_instructions === undefined
        ? buildAnalysisSystemPrompt({
            analysisGoal: normalizeAnalysisGoal(analysis_goal),
            ...(workflow_kind ? { workflowKind: workflow_kind } : {}),
          })
        : buildAnalysisSystemPrompt({
            analysisGoal: normalizeAnalysisGoal(analysis_goal),
            additionalInstructions: additional_instructions,
            ...(workflow_kind ? { workflowKind: workflow_kind } : {}),
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
        sessions: rows.map(s => buildSessionSummaryPayload(deps, s)),
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
      children: children.map(s => buildSessionSummaryPayload(deps, s)),
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
        const analysisState = session.analysisState as { phase?: string } | null
        if (analysisState?.phase === 'complete' || analysisState?.phase === 'error') {
          reply.code(422)
          return apiError('validation', `Analysis session is in terminal phase '${analysisState?.phase}'.`)
        }
        job = scheduler.enqueueStep(opCtx, sessionId, sessionId)
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

  app.post('/api/sessions/:sessionId/retry-failed-step', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    if (session.sessionType !== 'session_analysis') {
      reply.code(400)
      return apiError('validation', 'Session is not an analysis session.')
    }

    try {
      const result = resetFailedAnalysisStepForRetry(database, sessionId)
      return {
        api_version: 1 as const,
        session_id: sessionId,
        failed_step_id: result.failedStepId,
        retry_phase: result.retryPhase,
        ...(result.latestError ? { latest_error: result.latestError } : {}),
      }
    } catch (err) {
      if (err instanceof Error) {
        reply.code(422)
        return apiError('validation', err.message)
      }
      throw err
    }
  })

  app.post('/api/sessions/:sessionId/retry-init', async (request, reply) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(request.params)
    const session = getSessionRecord(database.connection, sessionId)
    if (!session) {
      reply.code(404)
      return apiError('not_found', 'Session not found')
    }
    if (session.initStatus !== 'error') {
      reply.code(422)
      return apiError('validation', 'Session is not in error state — nothing to retry.')
    }

    session.initStatus = 'pending'
    session.updatedAt = Date.now()
    updateSessionRecord(database.connection, session)

    scheduler.enqueueInit(opCtx, sessionId)
    return { ok: true }
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