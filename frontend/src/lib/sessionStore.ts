import { derived, get, writable } from 'svelte/store'
import {
  createSession,
  deleteSession as deleteBackendSession,
  getSessionTrace,
  importTrace as importBackendTrace,
  launchAnalysis as launchBackendAnalysis,
  listSessions,
  preflightSession,
  streamExecuteAnalysis as streamBackendExecuteAnalysis,
  streamPreludeInit,
  streamTurn as streamBackendTurn,
} from './api/backendClient'
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
import type {
  LmStudioConnection,
  McpServerProfile,
  ModelConfig,
} from './types'

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
export const activeTurnStream = writable<TurnStreamingState | null>(null)

export const activeSession = derived(
  [chatSessions, activeChatId],
  ([$chatSessions, $activeChatId]) => $chatSessions.find((session) => session.id === $activeChatId) ?? null,
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

function buildModelProfileSnapshot(modelConfig: ModelConfig, connection: LmStudioConnection) {
  return {
    id: modelConfig.id,
    name: modelConfig.name,
    connectionBaseUrl: connection.baseUrl,
    apiKey: connection.apiKey ?? null,
    modelKey: modelConfig.modelKey,
    modelDisplayName: modelConfig.modelDisplayName,
    systemPrompt: modelConfig.systemPrompt,
    temperature: modelConfig.temperature,
    reasoning: modelConfig.reasoning ?? null,
    createdAt: modelConfig.createdAt,
    updatedAt: modelConfig.updatedAt,
  }
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

async function refreshSessions(): Promise<SessionSummary[]> {
  const response = await listSessions({ includeChildren: true })
  const sessions = response.sessions
  chatSessions.set(sessions)
  return sessions
}

function toSessionSummary(record: SessionRecord): SessionSummary {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    init_status: record.initStatus,
    session_type: record.sessionType,
    parent_kind: record.parentKind,
    parent_id: record.parentId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    is_context_exhausted: record.isContextExhausted,
    loaded_context_length: record.loadedContextLength,
    compaction_strategy: record.compactionStrategy,
    model_profile_snapshot: { name: record.modelProfileSnapshot.name },
    mcp_profile_snapshot: record.mcpProfileSnapshot ? { name: record.mcpProfileSnapshot.name } : null,
  }
}

function upsertSessionSummary(record: SessionRecord): void {
  const summary = toSessionSummary(record)
  chatSessions.update((sessions) => sortByUpdatedAtDesc([
    summary,
    ...sessions.filter((existing) => existing.id !== summary.id),
  ]))
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

export async function selectChat(sessionId: string): Promise<void> {
  clearSessionError()
  activeChatId.set(sessionId)

  try {
    await refreshActiveTrace()
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
  modelConfig: ModelConfig
  connection: LmStudioConnection
  mcpProfile: McpServerProfile | null
  compactionStrategy: 'none' | 'strip-reasoning'
}): Promise<void> {
  clearSessionError()
  isStartingSession.set(true)
  try {
    const mcpSnapshot = input.mcpProfile ? buildMcpProfileSnapshot(input.mcpProfile) : null

    // Pre-flight: check connectivity before creating the session record
    await preflightSession({
      lmConnectionSnapshot: { baseUrl: input.connection.baseUrl, apiKey: input.connection.apiKey ?? null },
      mcpProfileSnapshot: mcpSnapshot ? { url: mcpSnapshot.url } : null,
      selectedModel: {
        modelKey: input.modelConfig.modelKey,
        modelDisplayName: input.modelConfig.modelDisplayName,
      },
    })

    const { session } = await createSession({
      sessionId: input.sessionId,
      modelProfileSnapshot: buildModelProfileSnapshot(input.modelConfig, input.connection),
      mcpProfileSnapshot: mcpSnapshot,
      compactionStrategy: input.compactionStrategy,
    })
    // Show the chat view immediately (composer locked until initStatus = 'ready')
    activeChatId.set(session.id)
    const summary = toSessionSummary(session)
    upsertSessionSummary(session)
    activeTrace.set(createEmptyTrace(summary))

    // Stream the prelude initialization — parts and token probing appear in real-time
    await streamPreludeInit(session.id, (event) => applyPreludeStreamEvent(event))

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
  setSessionError(new AppError(event.message, (event.errorType as AppError['errorType']) ?? 'internal', 0))
}

export async function sendMessage(input: {
  userContent: string
}): Promise<void> {
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
  let streamOutcome: 'committed' | 'failed' | null = null

  try {
    if (!sessionSummary) {
      throw new Error('Active session is not available for streaming')
    }

    activeTurnStream.set(createTurnStreamingState(sessionId, userContent))

    await streamBackendTurn(sessionId, userContent, async (event) => {
      if (event.type === 'turn-committed') {
        streamOutcome = 'committed'
      } else if (event.type === 'turn-failed') {
        streamOutcome = 'failed'
      }

      applyTurnStreamEvent(sessionSummary, userContent, event)
    })

    await refreshSessions()
    if (streamOutcome !== 'committed') {
      await refreshActiveTrace().catch(() => undefined)
    }
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

function applyTurnStreamEvent(
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
    activeTurnStream.update((state) => applyStreamingDelta(state, event.turnId, event.roundId, event.delta))
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
  setSessionError(new AppError(event.message, (event.errorType as AppError['errorType']) ?? 'internal', 0))
}

/**
 * Launch an analysis session for the given target session.
 *
 * Creates a session_analysis child session on the backend, navigates to it,
 * runs prelude initialization, then auto-sends the analysis prompt as the
 * first turn — all using the existing streaming infrastructure.
 */
export async function launchAnalysis(input: {
  targetSessionId: string
  targetTurnId: string
  analysisGoal: string
  analysisProfileId?: string
}): Promise<void> {
  clearSessionError()
  isLaunchingAnalysis.set(true)
  try {
    // The backend now owns the full analysis workflow: it creates the child session,
    // runs every step, and returns the completed session.
    const { session } = await launchBackendAnalysis(
      input.targetSessionId,
      {
        target_turn_id: input.targetTurnId,
        analysis_goal: input.analysisGoal,
        analysis_profile_id: input.analysisProfileId,
      },
    )

    // Add the completed session to the session list and navigate to it
    const summary = toSessionSummary(session)
    chatSessions.update((sessions) => {
      const filtered = sessions.filter((s) => s.id !== summary.id)
      return [...filtered, summary]
    })
    activeChatId.set(session.id)

    // Refresh to load the full session trace
    await refreshSessions()
  } catch (error) {
    setSessionError(toAppError(error))
  } finally {
    isLaunchingAnalysis.set(false)
  }
}

/**
 * Execute (or resume) the analysis workflow for the active analysis session.
 * Streams progress events back: LLM turn tokens (same as regular sessions)
 * and deterministic analysis step events.
 */
export async function executeAnalysis(): Promise<void> {
  const sessionId = get(activeChatId)
  if (!sessionId) {
    setSessionError(new AppError('No active analysis session', 'internal', 0))
    return
  }

  clearSessionError()
  isExecutingAnalysis.set(true)
  activeTurnStream.set(null)

  const sessionSummary = get(activeSession)

  try {
    await streamBackendExecuteAnalysis(sessionId, async (event: AnalysisStreamEvent) => {
      applyAnalysisStreamEvent(sessionSummary, event)
    })

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
  activeTurnStream.set(null)

  const sessionSummary = get(activeSession)

  try {
    await streamBackendExecuteAnalysis(sessionId, async (event: AnalysisStreamEvent) => {
      applyAnalysisStreamEvent(sessionSummary, event)
    }, { singleStep: true })

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

function applyAnalysisStreamEvent(
  session: SessionSummary | null,
  event: AnalysisStreamEvent,
): void {
  // Route turn-stream events to the existing handler
  if (
    event.type === 'turn-started'
    || event.type === 'round-started'
    || event.type === 'part-delta'
    || event.type === 'part-committed'
    || event.type === 'round-committed'
    || event.type === 'turn-committed'
    || event.type === 'turn-failed'
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
      const steps = existing >= 0
        ? trace.steps.map((s, i) => (i === existing ? event.step : s))
        : [...trace.steps, event.step]
      return { ...trace, steps }
    })
    return
  }

  if (event.type === 'analysis-phase-changed') {
    // Update the cursor step state in the trace
    activeTrace.update((trace) => {
      if (!trace) return trace
      const steps = trace.steps.map((s) => {
        if (s.stepTypeKey === 'analysis_v2_cursor') {
          return { ...s, state: { ...(s.state as Record<string, unknown>), phase: event.phase } }
        }
        return s
      })
      return { ...trace, steps }
    })
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
