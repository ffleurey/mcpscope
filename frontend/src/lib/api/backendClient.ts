import type { ZodType } from 'zod'
import {
  createSessionResponseSchema,
  listLmConnectionsResponseSchema,
  listMcpProfilesResponseSchema,
  listModelConfigsResponseSchema,
  listSessionsResponseSchema,
  preludeStreamEventSchema,
  turnStreamEventSchema,
  sessionTraceBundleSchema,
  upsertLmConnectionResponseSchema,
  upsertMcpProfileResponseSchema,
  upsertModelConfigResponseSchema,
  type LmStudioConnection,
  type McpProfileSnapshot,
  type McpServerProfile,
  type ModelConfig,
  type ModelProfileSnapshot,
  type PreludeStreamEvent,
  type SessionTraceBundle,
  type TurnStreamEvent,
} from '../backendTypes'

const apiBase = (import.meta.env.VITE_BACKEND_API_BASE ?? '').replace(/\/$/, '')

function buildUrl(path: string): string {
  return `${apiBase}${path}`
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: unknown
    schema?: ZodType<T>
  } = {},
): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  const payload = text.length > 0 ? JSON.parse(text) : null

  if (!response.ok) {
    const message = (
      payload
      && typeof payload === 'object'
      && 'error' in payload
      && typeof payload.error === 'string'
    )
      ? payload.error
      : `Backend request failed (${response.status})`
    throw new Error(message)
  }

  return options.schema ? options.schema.parse(payload) : payload as T
}

import { z } from 'zod'

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  sqlitePath: z.string(),
})

export function fetchHealth() {
  return request('/api/health', { schema: healthResponseSchema })
}

export function listSessions() {
  return request('/api/sessions', {
    schema: listSessionsResponseSchema,
  })
}

export function getSessionTrace(sessionId: string) {
  return request(`/api/sessions/${sessionId}/trace`, {
    schema: sessionTraceBundleSchema,
  })
}

export function createSession(input: {
  title?: string
  modelProfileSnapshot: ModelProfileSnapshot
  mcpProfileSnapshot?: McpProfileSnapshot | null
  compactionStrategy?: 'none' | 'strip-reasoning'
}) {
  return request('/api/sessions', {
    method: 'POST',
    body: input,
    schema: createSessionResponseSchema,
  })
}

export function createTurn(sessionId: string, userContent: string) {
  return request(`/api/sessions/${sessionId}/turns`, {
    method: 'POST',
    body: { userContent },
  })
}

function parseSseBlock(block: string): { eventName: string | null; dataText: string | null } | null {
  const lines = block.split(/\r?\n/)
  let eventName: string | null = null
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  return {
    eventName,
    dataText: dataLines.join('\n'),
  }
}

export async function streamTurn(
  sessionId: string,
  userContent: string,
  onEvent: (event: TurnStreamEvent) => void | Promise<void>,
): Promise<void> {
  const response = await fetch(buildUrl(`/api/sessions/${sessionId}/turns/stream`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ userContent }),
  })

  if (!response.ok) {
    const text = await response.text()
    const payload = text.length > 0 ? JSON.parse(text) : null
    const message = (
      payload
      && typeof payload === 'object'
      && 'error' in payload
      && typeof payload.error === 'string'
    )
      ? payload.error
      : `Backend request failed (${response.status})`
    throw new Error(message)
  }

  if (!response.body) {
    throw new Error('Streaming response body is missing')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    let separatorIndex = buffer.search(/\r?\n\r?\n/)
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + (buffer[separatorIndex] === '\r' ? 4 : 2))
      const parsed = parseSseBlock(block)
      if (parsed?.dataText) {
        const event = turnStreamEventSchema.parse(JSON.parse(parsed.dataText))
        if (parsed.eventName && parsed.eventName !== event.type) {
          throw new Error(`Streaming event mismatch: header=${parsed.eventName} payload=${event.type}`)
        }
        await onEvent(event)
      }
      separatorIndex = buffer.search(/\r?\n\r?\n/)
    }

    if (done) {
      break
    }
  }

  const trailing = parseSseBlock(buffer.trim())
  if (trailing?.dataText) {
    const event = turnStreamEventSchema.parse(JSON.parse(trailing.dataText))
    if (trailing.eventName && trailing.eventName !== event.type) {
      throw new Error(`Streaming event mismatch: header=${trailing.eventName} payload=${event.type}`)
    }
    await onEvent(event)
  }
}

export async function streamPreludeInit(
  sessionId: string,
  onEvent: (event: PreludeStreamEvent) => void | Promise<void>,
): Promise<void> {
  const response = await fetch(buildUrl(`/api/sessions/${sessionId}/initialize`), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    const payload = text.length > 0 ? JSON.parse(text) : null
    const message = (
      payload
      && typeof payload === 'object'
      && 'error' in payload
      && typeof payload.error === 'string'
    )
      ? payload.error
      : `Backend request failed (${response.status})`
    throw new Error(message)
  }

  if (!response.body) {
    throw new Error('Streaming response body is missing')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    let separatorIndex = buffer.search(/\r?\n\r?\n/)
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + (buffer[separatorIndex] === '\r' ? 4 : 2))
      const parsed = parseSseBlock(block)
      if (parsed?.dataText) {
        const event = preludeStreamEventSchema.parse(JSON.parse(parsed.dataText))
        if (parsed.eventName && parsed.eventName !== event.type) {
          throw new Error(`Streaming event mismatch: header=${parsed.eventName} payload=${event.type}`)
        }
        await onEvent(event)
      }
      separatorIndex = buffer.search(/\r?\n\r?\n/)
    }

    if (done) {
      break
    }
  }

  const trailing = parseSseBlock(buffer.trim())
  if (trailing?.dataText) {
    const event = preludeStreamEventSchema.parse(JSON.parse(trailing.dataText))
    if (trailing.eventName && trailing.eventName !== event.type) {
      throw new Error(`Streaming event mismatch: header=${trailing.eventName} payload=${event.type}`)
    }
    await onEvent(event)
  }
}

export function importTrace(trace: SessionTraceBundle) {
  return request('/api/traces/import', {
    method: 'POST',
    body: trace,
    schema: createSessionResponseSchema,
  })
}

export function deleteSession(sessionId: string) {
  return request<void>(`/api/sessions/${sessionId}`, {
    method: 'DELETE',
  })
}

export function patchSessionTitle(sessionId: string, title: string) {
  return request(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: { title },
    schema: createSessionResponseSchema,
  })
}

export function listLmConnections() {
  return request('/api/lm-connections', {
    schema: listLmConnectionsResponseSchema,
  })
}

export function upsertLmConnection(connection: LmStudioConnection) {
  return request(`/api/lm-connections/${connection.id}`, {
    method: 'PUT',
    body: connection,
    schema: upsertLmConnectionResponseSchema,
  })
}

export function deleteLmConnection(connectionId: string) {
  return request<void>(`/api/lm-connections/${connectionId}`, {
    method: 'DELETE',
  })
}

export function listModelConfigs() {
  return request('/api/model-configs', {
    schema: listModelConfigsResponseSchema,
  })
}

export function upsertModelConfig(modelConfig: ModelConfig) {
  return request(`/api/model-configs/${modelConfig.id}`, {
    method: 'PUT',
    body: modelConfig,
    schema: upsertModelConfigResponseSchema,
  })
}

export function deleteModelConfig(modelConfigId: string) {
  return request<void>(`/api/model-configs/${modelConfigId}`, {
    method: 'DELETE',
  })
}

export function listMcpProfiles() {
  return request('/api/mcp-profiles', {
    schema: listMcpProfilesResponseSchema,
  })
}

export function upsertMcpProfile(mcpProfile: McpServerProfile) {
  return request(`/api/mcp-profiles/${mcpProfile.id}`, {
    method: 'PUT',
    body: mcpProfile,
    schema: upsertMcpProfileResponseSchema,
  })
}

export function deleteMcpProfile(mcpProfileId: string) {
  return request<void>(`/api/mcp-profiles/${mcpProfileId}`, {
    method: 'DELETE',
  })
}

const mcpTestResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), serverName: z.string(), serverVersion: z.string(), tools: z.array(z.string()) }),
  z.object({ status: z.literal('error'), message: z.string() }),
])

export function testMcpProfile(url: string) {
  return request('/api/mcp-profiles/test', {
    method: 'POST',
    body: { url },
    schema: mcpTestResponseSchema,
  })
}
