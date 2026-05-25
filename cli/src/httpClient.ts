/**
 * CLI HTTP client — calls the mcpscope backend API and maps responses to the
 * canonical snake_case result types defined in @mcpscope/shared.
 *
 * This module is the CLI's remote-adapter execution layer. It is the only place
 * where the CLI makes HTTP calls to the backend. All result types are shared with
 * the MCP surface so CLI and MCP remain semantically identical.
 */
import { OperationError } from '@mcpscope/shared'
import type {
  ListResult,
  CreateInput,
  CreateResult,
  SendInput,
  SendResult,
  StatusInput,
  StatusResult,
  InspectInput,
  InspectResult,
} from '@mcpscope/shared'

// ─── HTTP primitives ──────────────────────────────────────────────────────────

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
    throw new OperationError(`Cannot reach backend at ${baseUrl}: ${message}`)
  }

  return parseResponse<T>(response, baseUrl)
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
    throw new OperationError(`Cannot reach backend at ${baseUrl}: ${message}`)
  }

  return parseResponse<T>(response, baseUrl)
}

async function parseResponse<T>(response: Response, _baseUrl: string): Promise<T> {
  let payload: unknown
  try {
    const text = await response.text()
    payload = text.length > 0 ? JSON.parse(text) : null
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new OperationError(`Backend returned invalid JSON: ${message}`)
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
    const code = errorObj?.code
    const fullMessage = activeSession
      ? `${message}\n  Blocking session: ${activeSession.id}  (${activeSession.state})`
      : message
    throw new OperationError(fullMessage, code, activeSession)
  }

  return payload as T
}

// ─── API response types (camelCase — matches backend HTTP API) ────────────────

interface ApiSessionSummary {
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

interface ApiCreatedSession {
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

// ─── Operation call functions — map API responses to shared result types ──────

/** GET /api/sessions → ListResult (snake_case) */
export async function cliList(baseUrl: string): Promise<ListResult> {
  const raw = await request<{ sessions: ApiSessionSummary[] }>(baseUrl, '/api/sessions')
  return {
    api_version: 1,
    sessions: raw.sessions.map(s => ({
      id: s.id,
      title: s.title,
      status: s.status,
      init_status: s.initStatus,
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

/** POST /api/sessions/from-defaults → CreateResult (snake_case) */
export async function cliCreate(baseUrl: string, input: CreateInput): Promise<CreateResult> {
  const body = {
    title: input.title,
    ...(input.id !== undefined ? { sessionId: input.id } : {}),
    ...(input.compaction !== undefined ? { compactionStrategy: input.compaction } : {}),
  }
  const raw = await post<{ session: ApiCreatedSession }>(baseUrl, '/api/sessions/from-defaults', body)
  const s = raw.session
  return {
    api_version: 1,
    session: {
      id: s.id,
      title: s.title,
      status: s.status,
      init_status: s.initStatus,
      model: s.model,
      mcp: s.mcp,
      compaction_strategy: s.compactionStrategy,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    },
  }
}

/** POST /api/sessions/:id/turns/start → SendResult (snake_case) */
export async function cliSend(baseUrl: string, input: SendInput): Promise<SendResult> {
  const raw = await post<{ sessionId: string; turn: { id: string; status: string } }>(
    baseUrl,
    `/api/sessions/${encodeURIComponent(input.session_id)}/turns/start`,
    { userContent: input.prompt },
  )
  return {
    api_version: 1,
    session_id: raw.sessionId,
    turn: { id: raw.turn.id, status: raw.turn.status },
  }
}

/** GET /api/sessions/:id/status → StatusResult (snake_case) */
export async function cliStatus(baseUrl: string, input: StatusInput): Promise<StatusResult> {
  const raw = await request<{
    session: { id: string; state: 'initializing' | 'ready' | 'running' | 'error' }
    activeTurn: { id: string; status: string } | null
  }>(baseUrl, `/api/sessions/${encodeURIComponent(input.session_id)}/status`)
  return {
    api_version: 1,
    session: { id: raw.session.id, state: raw.session.state },
    active_turn: raw.activeTurn
      ? { id: raw.activeTurn.id, status: raw.activeTurn.status }
      : null,
  }
}

/** GET /api/lookup/:id?mode=... → InspectResult */
export async function cliInspect(baseUrl: string, input: InspectInput): Promise<InspectResult> {
  const mode = input.short === true ? 'summary' : 'full'
  return request<InspectResult>(
    baseUrl,
    `/api/lookup/${encodeURIComponent(input.id)}?mode=${mode}`,
  )
}
