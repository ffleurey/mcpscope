import { derived, get, writable } from 'svelte/store'
import {
  createPrimarySession,
  deleteSession as deleteBackendSession,
  getSessionTrace,
  importTrace as importBackendTrace,
  launchAnalysis as launchBackendAnalysis,
  listSessions,
  preflightSession,
  retryFailedAnalysisStep as retryBackendFailedAnalysisStep,
  retryInitSession,
} from './api/backendClient'
import {
  lmConnections,
  mcpProfiles,
  modelConfigs,
  sessionCreationDefaults,
} from './connectionStore'
import type {
  AnalysisStreamEvent,
  PreludeStreamEvent,
  SessionRecord,
  SessionSummary,
  SessionTraceBundle,
  TurnStreamEvent,
} from './backendTypes'
import { sessionTraceBundleSchema } from './backendTypes'
import { AppError, toAppError } from './errors'
import {
  applyStreamingDelta,
  bindStreamingTurnId,
  clearCommittedStreamingDelta,
  clearRoundStreamingState,
  createEmptyTrace,
  createTurnStreamingState,
  insertStreamingUserPart,
  upsertPart,
  upsertRound,
  upsertTurn,
  type TurnStreamingState,
} from './traceStreaming'
import type { McpServerProfile } from './types'

export const sessionError = writable<AppError | null>(null)
export const sessionErrorSurface = writable<'dialog' | 'new-session'>('dialog')
export const chatSessions = writable<SessionSummary[]>([])
export const activeChatId = writable<string | null>(null)
export const activeTrace = writable<SessionTraceBundle | null>(null)
export const activeTraceLoading = writable(false)
export const isSendingTurn = writable(false)
export const isStartingSession = writable(false)
export const isImportingTrace = writable(false)
export const isLaunchingAnalysis = writable(false)
export const isExecutingAnalysis = writable(false)
export const isSteppingAnalysis = writable(false)
export const isRetryingAnalysis = writable(false)
export const activeTurnStream = writable<TurnStreamingState | null>(null)
export const isPrimaryLaunchDialogOpen = writable(false)

export const activeSession = derived(
  [chatSessions, activeChatId],
  ([$chatSessions, $activeChatId]) =>
    $chatSessions.find((session) => session.id === $activeChatId) ?? null,
)

export function clearSessionError(): void {
  sessionError.set(null)
  sessionErrorSurface.set('dialog')
}

function setSessionError(error: AppError, surface: 'dialog' | 'new-session' = 'dialog'): void {
  sessionError.set(error)
  sessionErrorSurface.set(surface)
}

function sortByUpdatedAtDesc<T extends { updated_at: number }>(records: T[]): T[] {
  return [...records].sort((left, right) => right.updated_at - left.updated_at)
}

function buildMcpProfileSnapshot(mcpProfile: McpServerProfile) {
  return {
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

export async function refreshSessions(): Promise<SessionSummary[]> {
  const response = await listSessions({ includeChildren: true })
  const sessions = response.sessions
  chatSessions.set(sessions)
  return sessions
}

function toSessionSummary(record: SessionRecord): SessionSummary {
  const status: SessionSummary['status'] =
    record.initStatus === 'error' || record.status === 'error'
      ? 'error'
      : record.initStatus === 'pending' || record.initStatus === 'initializing'
        ? 'initializing'
        : record.status === 'active'
          ? 'running'
          : 'ready'

  return {
    id: record.id,
    title: record.title,
    status,
    init_status: record.initStatus,
    session_type: record.sessionType,
    parent_kind: record.parentKind,
    parent_id: record.parentId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    is_context_exhausted: record.isContextExhausted,
    loaded_context_length: record.loadedContextLength,
    compaction_strategy: record.compactionStrategy,
    workflow_kind: undefined,
    workflow_phase: undefined,
    latest_error: undefined,
    model_profile_snapshot: { name: record.modelProfileSnapshot.name },
    mcp_profile_snapshots: record.mcpProfileSnapshots.map((s) => ({ name: s.name })),
  }
}

function upsertSessionSummary(record: SessionRecord): void {
  const existing = get(chatSessions).find((session) => session.id === record.id)
  const summary = {
    ...toSessionSummary(record),
    ...(existing?.workflow_kind ? { workflow_kind: existing.workflow_kind } : {}),
    ...(existing?.workflow_phase ? { workflow_phase: existing.workflow_phase } : {}),
  }
  chatSessions.update((sessions) =>
    sortByUpdatedAtDesc([summary, ...sessions.filter((existing) => existing.id !== summary.id)]),
  )
}

function currentOrEmptyTrace(session: SessionSummary): SessionTraceBundle {
  return get(activeTrace) ?? createEmptyTrace(session)
}

async function refreshActiveTrace(): Promise<SessionTraceBundle | null> {
  const sessionId = get(activeChatId)
  if (!sessionId) {
    activeTrace.set(null)
    return null
  }

  activeTraceLoading.set(true)
  try {
    const trace = await getSessionTrace(sessionId)
    activeTrace.set(trace)
    return trace
  } finally {
    activeTraceLoading.set(false)
  }
}

export async function initSessionStore(): Promise<void> {
  clearSessionError()
  await refreshSessions()
  activeChatId.set(null)
  activeTrace.set(null)
  activeTurnStream.set(null)
}

export function startDraftSession(): void {
  clearSessionError()
  activeChatId.set(null)
  activeTrace.set(null)
  activeTurnStream.set(null)
}

/**
 * Called by executionStore when the scheduler starts a job for a session.
 * If that session is currently open and not already streaming, prime
 * activeTurnStream so live scheduler-execution-events will render.
 */
export function initExternalTurnStream(sessionId: string, prompt: string): void {
  if (get(activeChatId) !== sessionId) return
  if (get(activeTurnStream) !== null) return
  activeTurnStream.set(createTurnStreamingState(sessionId, prompt))
}

/**
 * Called by executionStore when a scheduler-execution-event arrives for a
 * session that is currently open. Routes the event to activeTurnStream /
 * activeTrace exactly as the frontend-initiated streaming path does.
 */
export function applyExternalStreamEvent(
  sessionId: string,
  prompt: string,
  event: TurnStreamEvent | AnalysisStreamEvent,
): void {
  if (get(activeChatId) !== sessionId) return
  const session = get(chatSessions).find((s) => s.id === sessionId) ?? null
  const isAnalysis = session?.session_type === 'session_analysis'
  const isTurnEvent =
    event.type === 'turn-started' ||
    event.type === 'round-started' ||
    event.type === 'part-delta' ||
    event.type === 'part-committed' ||
    event.type === 'round-committed' ||
    event.type === 'turn-committed' ||
    event.type === 'turn-failed'
  // For analysis sessions, route all events (including turn-committed) through
  // applyAnalysisStreamEvent so it can keep activeTurnStream alive between turns.
  if (isAnalysis) {
    applyAnalysisStreamEvent(session, event as AnalysisStreamEvent)
  } else if (isTurnEvent && session) {
    applyTurnStreamEvent(session, prompt, event as TurnStreamEvent)
  } else if (!isTurnEvent) {
    applyAnalysisStreamEvent(session, event as AnalysisStreamEvent)
  }
}

/**
 * Called by executionStore when a prelude event arrives from the scheduler
 * for a session that is currently open. Routes part-committed / prelude-complete
 * / prelude-failed events to update the active trace.
 */
export function applyExternalPreludeEvent(sessionId: string, event: PreludeStreamEvent): void {
  if (get(activeChatId) !== sessionId) return
  applyPreludeStreamEvent(event)
}

/**
 * Exported for executionStore — refreshes the active trace after a job completes.
 */
export async function refreshActiveTurnTrace(): Promise<void> {
  await refreshActiveTrace()
}

export function openPrimaryLaunchDialog(): void {
  clearSessionError()
  isPrimaryLaunchDialogOpen.set(true)
}

export function closePrimaryLaunchDialog(): void {
  isPrimaryLaunchDialogOpen.set(false)
}

/**
 * Reset the chat selection without touching benchmark state. Called by the
 * benchmark store on selectRun (mutual selection reset).
 */
export function clearChatSelection(): void {
  activeChatId.set(null)
  activeTrace.set(null)
  activeTurnStream.set(null)
}

export async function selectChat(sessionId: string): Promise<void> {
  clearSessionError()
  activeChatId.set(sessionId)

  // Mutual reset: opening a chat closes any open benchmark run report and
  // benchmark detail view.
  void import('./benchmarkStore').then(({ clearActiveRun, clearBenchmarkSelection }) => {
    clearActiveRun()
    clearBenchmarkSelection()
  })

  try {
    await refreshActiveTrace()
    // If a scheduler job is running for this session, restore live streaming state.
    // Replay cached execution events that arrived while this session was not selected,
    // then prime activeTurnStream for any new events still in flight.
    const {
      schedulerSnapshot: snap,
      getSessionStreamEvents,
      clearSessionStreamCache,
    } = await import('./executionStore')
    const currentSnap = get(snap)
    const isJobActive =
      currentSnap.activeJob?.target.sessionId === sessionId ||
      currentSnap.pendingJobs.some((j) => j.target.sessionId === sessionId)

    if (isJobActive) {
      const cachedEvents = getSessionStreamEvents(sessionId)
      if (cachedEvents.length > 0) {
        // Find the boundary: only replay events after the last terminal event
        // (turn-committed / analysis-complete / analysis-failed). Events before
        // the boundary are already reflected in the DB-loaded trace.
        const TERMINAL_TYPES = new Set(['turn-committed', 'analysis-complete', 'analysis-failed'])
        let startIdx = 0
        for (let i = cachedEvents.length - 1; i >= 0; i--) {
          if (TERMINAL_TYPES.has(cachedEvents[i]!.type)) {
            startIdx = i + 1
            break
          }
        }
        const eventsToReplay = cachedEvents.slice(startIdx)

        if (eventsToReplay.length > 0) {
          // Initialize activeTurnStream so replay deltas have somewhere to land
          activeTurnStream.set(
            createTurnStreamingState(sessionId, currentSnap.activeJob?.prompt ?? ''),
          )
          const sessionSummary = get(chatSessions).find((s) => s.id === sessionId) ?? null
          const isAnalysis = sessionSummary?.session_type === 'session_analysis'
          for (const event of eventsToReplay) {
            if (isAnalysis && sessionSummary) {
              applyAnalysisStreamEvent(sessionSummary, event as AnalysisStreamEvent)
            } else if (!isAnalysis && sessionSummary) {
              applyTurnStreamEvent(
                sessionSummary,
                currentSnap.activeJob?.prompt ?? '',
                event as TurnStreamEvent,
              )
            }
          }
        } else if (get(activeTurnStream) === null) {
          // No in-flight events but job is still running — keep stream open
          activeTurnStream.set(
            createTurnStreamingState(sessionId, currentSnap.activeJob?.prompt ?? ''),
          )
        }
        // Cache served its purpose — clear it; new events come in live
        clearSessionStreamCache(sessionId)
      } else if (get(activeTurnStream) === null) {
        activeTurnStream.set(
          createTurnStreamingState(sessionId, currentSnap.activeJob?.prompt ?? ''),
        )
      }
    }
  } catch (error) {
    setSessionError(toAppError(error))
    throw error
  }
}

export async function retryInit(sessionId: string): Promise<void> {
  clearSessionError()
  try {
    await retryInitSession(sessionId)
    await refreshSessions()
  } catch (error) {
    setSessionError(toAppError(error))
    throw error
  }
}

export async function deleteChat(sessionId: string): Promise<void> {
  clearSessionError()

  try {
    await deleteBackendSession(sessionId)
    const wasActive = get(activeChatId) === sessionId
    await refreshSessions()
    if (wasActive) {
      activeChatId.set(null)
      activeTrace.set(null)
      activeTurnStream.set(null)
    }
  } catch (error) {
    setSessionError(toAppError(error))
    throw error
  }
}

export async function startSession(input: {
  sessionId?: string
  modelConfigId?: string
  mcpProfileIds?: string[]
  compactionStrategy: 'none' | 'strip-reasoning'
}): Promise<void> {
  clearSessionError()
  isStartingSession.set(true)
  try {
    const defaults = get(sessionCreationDefaults)
    const resolvedModelConfigId = input.modelConfigId ?? defaults?.defaultModelConfigId ?? undefined
    const selectedModelConfig = resolvedModelConfigId
      ? get(modelConfigs).find((config) => config.id === resolvedModelConfigId)
      : undefined

    if (!selectedModelConfig) {
      throw new AppError(
        'No model config is available for the primary session constructor.',
        'validation',
        0,
      )
    }

    const selectedConnection = get(lmConnections).find(
      (connection) => connection.id === selectedModelConfig.connectionId,
    )
    if (!selectedConnection) {
      throw new AppError(
        `LM connection "${selectedModelConfig.connectionId}" referenced by the selected model config no longer exists.`,
        'validation',
        0,
      )
    }

    const allProfiles = get(mcpProfiles)
    const resolvedMcpIds =
      input.mcpProfileIds ?? allProfiles.filter((p) => p.defaultEnabled).map((p) => p.id)
    const selectedMcpProfiles = resolvedMcpIds
      .map((id) => allProfiles.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => p != null)
    const mcpSnapshots = selectedMcpProfiles.map((p) => buildMcpProfileSnapshot(p))

    // Pre-flight: check connectivity before creating the session record
    await preflightSession({
      lmConnectionSnapshot: {
        baseUrl: selectedConnection.baseUrl,
        apiKey: selectedConnection.apiKey ?? null,
      },
      mcpProfileSnapshots: mcpSnapshots.map((s) => ({ url: s.url })),
      selectedModel: {
        modelKey: selectedModelConfig.modelKey,
        modelDisplayName: selectedModelConfig.modelDisplayName,
      },
      providerType: selectedConnection.providerType,
    })

    const { session, initJobId } = await createPrimarySession({
      session_id: input.sessionId,
      model_config_id: selectedModelConfig.id,
      mcp_profile_ids: resolvedMcpIds,
      compaction_strategy: input.compactionStrategy,
    })
    // Show the chat view immediately (composer locked until initStatus = 'ready')
    activeChatId.set(session.id)
    const summary = toSessionSummary(session)
    upsertSessionSummary(session)
    activeTrace.set(createEmptyTrace(summary))

    // Wait for the scheduler to finish the auto-enqueued init job.
    // Prelude events flow through executionStore → applyExternalPreludeEvent
    // so the trace updates in real time without a dedicated SSE stream.
    isPrimaryLaunchDialogOpen.set(false)
    const { awaitJob } = await import('./executionStore')
    await awaitJob(session.id, initJobId)

    await refreshSessions()
  } catch (error) {
    setSessionError(toAppError(error), 'new-session')
  } finally {
    isStartingSession.set(false)
  }
}

function applyPreludeStreamEvent(event: PreludeStreamEvent): void {
  if (event.type === 'part-committed') {
    activeTrace.update((trace) => {
      if (!trace) return trace
      return upsertPart(trace, event.part)
    })
    return
  }

  if (event.type === 'prelude-complete') {
    activeTrace.set(event.trace)
    upsertSessionSummary(event.trace.session)
    return
  }

  // prelude-failed
  setSessionError(
    new AppError(event.message, (event.errorType as AppError['errorType']) ?? 'internal', 0),
  )
}

export async function sendMessage(input: { userContent: string }): Promise<void> {
  const userContent = input.userContent.trim()
  if (!userContent) return

  const sessionId = get(activeChatId)
  if (!sessionId) {
    setSessionError(new AppError('No active session — start a session first', 'internal', 0))
    return
  }

  clearSessionError()
  isSendingTurn.set(true)
  activeTurnStream.set(null)

  const sessionSummary = get(activeSession)

  try {
    if (!sessionSummary) {
      throw new Error('Active session is not available for streaming')
    }

    activeTurnStream.set(createTurnStreamingState(sessionId, userContent))

    const { enqueueSessionExecution, awaitJob } = await import('./executionStore')
    const job = await enqueueSessionExecution(sessionId, userContent)
    await awaitJob(sessionId, job.jobId)

    await refreshSessions()
  } catch (error) {
    setSessionError(toAppError(error))
    await refreshSessions().catch(() => undefined)
    await refreshActiveTrace().catch(() => undefined)
  } finally {
    activeTurnStream.set(null)
    isSendingTurn.set(false)
  }
}

export function exportActiveTrace(): void {
  const trace = get(activeTrace)
  if (!trace) return

  const payload = JSON.stringify(trace, null, 2)
  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = `${trace.session.title.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || trace.session.id}.trace.json`
  anchor.click()

  URL.revokeObjectURL(url)
}

export async function importTraceFile(file: File): Promise<void> {
  clearSessionError()
  isImportingTrace.set(true)

  try {
    const payload = await file.text()
    const trace = sessionTraceBundleSchema.parse(JSON.parse(payload))
    const { session } = await importBackendTrace(trace)

    await refreshSessions()
    await selectChat(session.id)
  } catch (error) {
    setSessionError(toAppError(error))
    throw error
  } finally {
    isImportingTrace.set(false)
  }
}

export function applyTurnStreamEvent(
  session: SessionSummary,
  userContent: string,
  event: TurnStreamEvent,
): void {
  if (event.type === 'turn-started') {
    activeTurnStream.update((state) => bindStreamingTurnId(state, event.turn.id))
    activeTrace.update((trace) => upsertTurn(trace ?? createEmptyTrace(session), event.turn))
    return
  }

  if (event.type === 'round-started') {
    activeTrace.update((trace) => {
      const nextTrace = upsertRound(trace ?? createEmptyTrace(session), event.round)
      return event.round.roundIndex === 0
        ? insertStreamingUserPart(nextTrace, {
            turnId: event.round.turnId,
            roundId: event.round.id,
            userContent,
            createdAt: event.round.startedAt,
          })
        : nextTrace
    })
    return
  }

  if (event.type === 'part-delta') {
    activeTurnStream.update((state) =>
      applyStreamingDelta(state, event.turnId, event.roundId, event.delta),
    )
    return
  }

  if (event.type === 'part-committed') {
    activeTurnStream.update((state) => clearCommittedStreamingDelta(state, event.part))
    activeTrace.update((trace) => upsertPart(trace ?? currentOrEmptyTrace(session), event.part))
    return
  }

  if (event.type === 'round-committed') {
    activeTurnStream.update((state) => clearRoundStreamingState(state, event.round.id))
    activeTrace.update((trace) => upsertRound(trace ?? currentOrEmptyTrace(session), event.round))
    return
  }

  if (event.type === 'turn-committed') {
    activeTurnStream.set(null)
    activeTrace.set(event.trace)
    upsertSessionSummary(event.trace.session)
    return
  }

  activeTurnStream.set(null)
  // turn-failed event
  setSessionError(
    new AppError(event.message, (event.errorType as AppError['errorType']) ?? 'internal', 0),
  )
}

/**
 * Launch an analysis session for the given target session.
 *
 * Creates a backend-owned session_analysis child session, updates the session
 * list, and navigates to it. Analysis execution is a separate streamed action.
 */
export async function launchAnalysis(input: {
  targetSessionId: string
  targetTurnId: string
  workflowKind?: 'full_session_analysis' | 'fast_session_analysis' | 'fast_tool_analysis'
  analysisGoal?: string
  modelConfigId?: string
  additionalInstructions?: string
  systemPromptOverride?: string
  temperature?: number
  selectedToolNames?: string[]
  onlyFailedToolCalls?: boolean
  evaluationCriteria?: string[]
}): Promise<void> {
  clearSessionError()
  isLaunchingAnalysis.set(true)
  try {
    const { session } = await launchBackendAnalysis({
      target_session_id: input.targetSessionId,
      target_turn_id: input.targetTurnId,
      workflow_kind: input.workflowKind,
      analysis_goal: input.analysisGoal,
      model_config_id: input.modelConfigId,
      additional_instructions: input.additionalInstructions,
      system_prompt_override: input.systemPromptOverride,
      temperature: input.temperature,
      selected_tool_names: input.selectedToolNames,
      only_failed_tool_calls: input.onlyFailedToolCalls,
      evaluation_criteria: input.evaluationCriteria,
    })

    // Add the completed session to the session list and navigate to it
    const summary = toSessionSummary(session)
    chatSessions.update((sessions) => {
      const filtered = sessions.filter((s) => s.id !== summary.id)
      return [...filtered, summary]
    })
    activeChatId.set(session.id)

    // Refresh to load the created analysis session immediately in the chat view.
    await refreshActiveTrace()
    await refreshSessions()
  } catch (error) {
    setSessionError(toAppError(error))
  } finally {
    isLaunchingAnalysis.set(false)
  }
}

/**
 * Execute (or resume) the analysis workflow for the active analysis session.
 * Streams normal turn events plus analysis workflow events from the backend.
 */
export async function executeAnalysis(): Promise<void> {
  const sessionId = get(activeChatId)
  if (!sessionId) {
    setSessionError(new AppError('No active analysis session', 'internal', 0))
    return
  }

  clearSessionError()
  isExecutingAnalysis.set(true)
  // Initialize streaming state so part-delta events render immediately.
  // Analysis sessions use '' as userContent (no single user message).
  activeTurnStream.set(createTurnStreamingState(sessionId, ''))

  try {
    const { enqueueSessionExecution, awaitJob } = await import('./executionStore')
    const job = await enqueueSessionExecution(sessionId, '')
    await awaitJob(sessionId, job.jobId)

    await refreshSessions()
  } catch (error) {
    setSessionError(toAppError(error))
    await refreshSessions().catch(() => undefined)
    await refreshActiveTrace().catch(() => undefined)
  } finally {
    activeTurnStream.set(null)
    isExecutingAnalysis.set(false)
  }
}

/**
 * Advance the analysis workflow by exactly one step, then stop.
 * Used by the Step button for step-by-step debugging.
 */
export async function executeAnalysisStep(): Promise<void> {
  const sessionId = get(activeChatId)
  if (!sessionId) {
    setSessionError(new AppError('No active analysis session', 'internal', 0))
    return
  }

  clearSessionError()
  isSteppingAnalysis.set(true)
  activeTurnStream.set(createTurnStreamingState(sessionId, ''))

  try {
    const { enqueueStepExecution, awaitJob } = await import('./executionStore')
    const job = await enqueueStepExecution(sessionId)
    await awaitJob(sessionId, job.jobId)

    await refreshSessions()
  } catch (error) {
    setSessionError(toAppError(error))
    await refreshSessions().catch(() => undefined)
    await refreshActiveTrace().catch(() => undefined)
  } finally {
    activeTurnStream.set(null)
    isSteppingAnalysis.set(false)
  }
}

export async function retryFailedAnalysisStep(): Promise<void> {
  const sessionId = get(activeChatId)
  if (!sessionId) {
    setSessionError(new AppError('No active analysis session', 'internal', 0))
    return
  }

  clearSessionError()
  isRetryingAnalysis.set(true)

  try {
    await retryBackendFailedAnalysisStep(sessionId)
    await refreshSessions()
    await refreshActiveTrace()
    await executeAnalysisStep()
  } catch (error) {
    setSessionError(toAppError(error))
    await refreshSessions().catch(() => undefined)
    await refreshActiveTrace().catch(() => undefined)
  } finally {
    isRetryingAnalysis.set(false)
  }
}

export function applyAnalysisStreamEvent(
  session: SessionSummary | null,
  event: AnalysisStreamEvent,
): void {
  // Route turn-stream events to the existing handler, with a special case for
  // turn-committed: primary sessions clear activeTurnStream on turn-committed,
  // but analysis sessions may run multiple turns. Reset to a fresh streaming
  // state so the next turn-started can bind its turn ID correctly.
  if (event.type === 'turn-committed') {
    activeTrace.set(event.trace)
    upsertSessionSummary(event.trace.session)
    if (session) {
      activeTurnStream.set(createTurnStreamingState(session.id, ''))
    }
    return
  }
  if (
    event.type === 'turn-started' ||
    event.type === 'round-started' ||
    event.type === 'part-delta' ||
    event.type === 'part-committed' ||
    event.type === 'round-committed' ||
    event.type === 'turn-failed'
  ) {
    if (session) {
      applyTurnStreamEvent(session, '', event as TurnStreamEvent)
    }
    return
  }

  if (event.type === 'analysis-step-started' || event.type === 'analysis-step-completed') {
    // Upsert the step record into the active trace
    activeTrace.update((trace) => {
      if (!trace) return trace
      const existing = trace.steps.findIndex((s) => s.id === event.step.id)
      const steps =
        existing >= 0
          ? trace.steps.map((s, i) => (i === existing ? event.step : s))
          : [...trace.steps, event.step]
      return { ...trace, steps }
    })
    return
  }

  if (event.type === 'analysis-phase-changed') {
    // Keep the analysis phase visible through the session summary instead of a cursor node.
    chatSessions.update((sessions) =>
      sessions.map((existing) =>
        existing.id === session?.id
          ? { ...existing, workflow_phase: event.phase as SessionSummary['workflow_phase'] }
          : existing,
      ),
    )
    return
  }

  if (event.type === 'analysis-complete') {
    activeTurnStream.set(null)
    activeTrace.set(event.trace)
    upsertSessionSummary(event.trace.session)
    return
  }

  if (event.type === 'analysis-failed') {
    activeTurnStream.set(null)
    setSessionError(new AppError(event.message, 'internal', 0))
  }
}
