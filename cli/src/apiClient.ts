import { CliError } from './errors.js'

interface ApiErrorPayload {
  error?: { message?: string } | string
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

  const text = await response.text()
  const payload: unknown = text.length > 0 ? JSON.parse(text) : null

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
    throw new CliError(message, 1)
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
