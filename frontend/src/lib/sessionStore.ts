import { derived, get, writable } from 'svelte/store'
import {
  createSession,
  deleteSession as deleteBackendSession,
  getSessionTrace,
  importTrace as importBackendTrace,
  listSessions,
  streamTurn as streamBackendTurn,
} from './api/backendClient'
import type {
  SessionRecord,
  SessionTraceBundle,
  TurnStreamEvent,
} from './backendTypes'
import { sessionTraceBundleSchema } from './backendTypes'
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

export const sessionError = writable<string | null>(null)
export const chatSessions = writable<SessionRecord[]>([])
export const activeChatId = writable<string | null>(null)
export const activeTrace = writable<SessionTraceBundle | null>(null)
export const activeTraceLoading = writable(false)
export const isSendingTurn = writable(false)
export const isStartingSession = writable(false)
export const isImportingTrace = writable(false)
export const activeTurnStream = writable<TurnStreamingState | null>(null)

export const activeSession = derived(
  [chatSessions, activeChatId],
  ([$chatSessions, $activeChatId]) => $chatSessions.find((session) => session.id === $activeChatId) ?? null,
)

function sortByUpdatedAtDesc<T extends { updatedAt: number }>(records: T[]): T[] {
  return [...records].sort((left, right) => right.updatedAt - left.updatedAt)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildDraftTitle(userContent: string): string {
  const trimmed = userContent.trim().replace(/\s+/g, ' ')
  return trimmed.slice(0, 60) || 'New session'
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

async function refreshSessions(): Promise<SessionRecord[]> {
  const response = await listSessions()
  const sessions = sortByUpdatedAtDesc(response.sessions)
  chatSessions.set(sessions)
  return sessions
}

function upsertSessionSummary(session: SessionRecord): void {
  chatSessions.update((sessions) => sortByUpdatedAtDesc([
    session,
    ...sessions.filter((existing) => existing.id !== session.id),
  ]))
}

function currentOrEmptyTrace(session: SessionRecord): SessionTraceBundle {
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
  sessionError.set(null)
  await refreshSessions()
  activeChatId.set(null)
  activeTrace.set(null)
  activeTurnStream.set(null)
}

export function startDraftSession(): void {
  sessionError.set(null)
  activeChatId.set(null)
  activeTrace.set(null)
  activeTurnStream.set(null)
}

export async function selectChat(sessionId: string): Promise<void> {
  sessionError.set(null)
  activeChatId.set(sessionId)

  try {
    await refreshActiveTrace()
  } catch (error) {
    sessionError.set(formatError(error))
    throw error
  }
}

export async function deleteChat(sessionId: string): Promise<void> {
  sessionError.set(null)

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
    sessionError.set(formatError(error))
    throw error
  }
}

export async function startSession(input: {
  modelConfig: ModelConfig
  connection: LmStudioConnection
  mcpProfile: McpServerProfile | null
  compactionStrategy: 'none' | 'strip-reasoning'
}): Promise<void> {
  sessionError.set(null)
  isStartingSession.set(true)
  try {
    const { session } = await createSession({
      modelProfileSnapshot: buildModelProfileSnapshot(input.modelConfig, input.connection),
      mcpProfileSnapshot: input.mcpProfile ? buildMcpProfileSnapshot(input.mcpProfile) : null,
      compactionStrategy: input.compactionStrategy,
    })
    activeChatId.set(session.id)
    upsertSessionSummary(session)
    await refreshActiveTrace()
  } catch (error) {
    sessionError.set(formatError(error))
  } finally {
    isStartingSession.set(false)
  }
}

export async function sendMessage(input: {
  userContent: string
}): Promise<void> {
  const userContent = input.userContent.trim()
  if (!userContent) return

  const sessionId = get(activeChatId)
  if (!sessionId) {
    sessionError.set('No active session — start a session first')
    return
  }

  sessionError.set(null)
  isSendingTurn.set(true)
  activeTurnStream.set(null)

  const sessionRecord = get(activeSession)
  let streamOutcome: 'committed' | 'failed' | null = null

  try {
    if (!sessionRecord) {
      throw new Error('Active session is not available for streaming')
    }

    activeTurnStream.set(createTurnStreamingState(sessionId, userContent))

    await streamBackendTurn(sessionId, userContent, async (event) => {
      if (event.type === 'turn-committed') {
        streamOutcome = 'committed'
      } else if (event.type === 'turn-failed') {
        streamOutcome = 'failed'
      }

      applyTurnStreamEvent(sessionRecord as SessionRecord, userContent, event)
    })

    await refreshSessions()
    if (streamOutcome !== 'committed') {
      await refreshActiveTrace().catch(() => undefined)
    }
  } catch (error) {
    sessionError.set(formatError(error))
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
  sessionError.set(null)
  isImportingTrace.set(true)

  try {
    const payload = await file.text()
    const trace = sessionTraceBundleSchema.parse(JSON.parse(payload))
    const { session } = await importBackendTrace(trace)

    await refreshSessions()
    await selectChat(session.id)
  } catch (error) {
    sessionError.set(formatError(error))
    throw error
  } finally {
    isImportingTrace.set(false)
  }
}

function applyTurnStreamEvent(
  session: SessionRecord,
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
  sessionError.set(event.message)
}
