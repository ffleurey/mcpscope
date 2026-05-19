import { CliError } from './errors.js'

interface ApiErrorPayload {
  error?: { message?: string; code?: string; active_session?: { id: string; state: string } } | string
}

async function request<T>(baseUrl: string, path: string): Promise<T> {
  const url = `${baseUrl}${path}`
  let response: Response

  try {
    response = await fetch(url)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new CliError(`Cannot reach backend at ${baseUrl}: ${message}`, 1)
  }

  let payload: unknown
  try {
    const text = await response.text()
    payload = text.length > 0 ? JSON.parse(text) : null
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new CliError(`Backend returned invalid JSON: ${message}`, 1)
  }

  if (!response.ok) {
    const errPayload = payload as ApiErrorPayload | null
    const errorObj = (
      errPayload
      && typeof errPayload === 'object'
      && 'error' in errPayload
      && errPayload.error !== null
      && typeof errPayload.error === 'object'
    ) ? errPayload.error : null

    const message = errorObj?.message
      ?? (typeof errPayload?.error === 'string' ? errPayload.error : `Backend request failed (${response.status})`)
    const activeSession = errorObj?.active_session
    const fullMessage = activeSession
      ? `${message}\n  Blocking session: ${activeSession.id}  (${activeSession.state})`
      : message
    const err = new CliError(fullMessage, 1)
    if (errorObj?.code !== undefined) {
      (err as CliError & { code?: string }).code = errorObj.code
    }
    throw err
  }

  return payload as T
}

async function post<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const url = `${baseUrl}${path}`
  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new CliError(`Cannot reach backend at ${baseUrl}: ${message}`, 1)
  }

  let payload: unknown
  try {
    const text = await response.text()
    payload = text.length > 0 ? JSON.parse(text) : null
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new CliError(`Backend returned invalid JSON: ${message}`, 1)
  }

  if (!response.ok) {
    const errPayload = payload as ApiErrorPayload | null
    const errorObj = (
      errPayload
      && typeof errPayload === 'object'
      && 'error' in errPayload
      && errPayload.error !== null
      && typeof errPayload.error === 'object'
    ) ? errPayload.error : null

    const message = errorObj?.message
      ?? (typeof errPayload?.error === 'string' ? errPayload.error : `Backend request failed (${response.status})`)
    const activeSession = errorObj?.active_session
    const fullMessage = activeSession
      ? `${message}\n  Blocking session: ${activeSession.id}  (${activeSession.state})`
      : message
    const err = new CliError(fullMessage, 1)
    if (errorObj?.code !== undefined) {
      (err as CliError & { code?: string }).code = errorObj.code
    }
    throw err
  }

  return payload as T
}

export interface SessionSummary {
  id: string
  title: string
  status: string
  initStatus: string
  createdAt: number
  updatedAt: number
  isContextExhausted: boolean
  loadedContextLength: number | null
  compactionStrategy: string
  modelProfileSnapshot: { name: string }
  mcpProfileSnapshot: { name: string } | null
}

export interface ListSessionsResponse {
  sessions: SessionSummary[]
}

export function listSessions(baseUrl: string): Promise<ListSessionsResponse> {
  return request<ListSessionsResponse>(baseUrl, '/api/sessions')
}

export interface LookupResponse {
  id: string
  type: string
  mode: string
  data: Record<string, unknown>
}

export function lookupById(baseUrl: string, id: string, mode: 'summary' | 'full'): Promise<LookupResponse> {
  return request<LookupResponse>(baseUrl, `/api/lookup/${encodeURIComponent(id)}?mode=${mode}`)
}

export interface CreateFromDefaultsInput {
  title?: string | undefined
  sessionId?: string | undefined
  compactionStrategy?: 'none' | 'strip-reasoning' | undefined
}

export interface CreatedSessionSummary {
  id: string
  title: string
  status: string
  initStatus: string
  model: { id: string; name: string }
  mcp: { id: string; name: string } | null
  compactionStrategy: string
  createdAt: number
  updatedAt: number
}

export interface CreateFromDefaultsResponse {
  session: CreatedSessionSummary
}

export function createSessionFromDefaults(
  baseUrl: string,
  input: CreateFromDefaultsInput,
): Promise<CreateFromDefaultsResponse> {
  return post<CreateFromDefaultsResponse>(baseUrl, '/api/sessions/from-defaults', input)
}

export interface SessionStatusResponse {
  session: { id: string; state: 'initializing' | 'ready' | 'running' | 'error' }
  activeTurn: { id: string; status: string } | null
}

export function getSessionStatus(baseUrl: string, sessionId: string): Promise<SessionStatusResponse> {
  return request<SessionStatusResponse>(baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/status`)
}

export interface StartTurnResponse {
  sessionId: string
  turn: { id: string; status: string }
}

export function startTurn(
  baseUrl: string,
  sessionId: string,
  userContent: string,
): Promise<StartTurnResponse> {
  return post<StartTurnResponse>(baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/turns/start`, { userContent })
}
