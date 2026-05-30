import type { ZodType } from 'zod'
import {
  createSessionResponseSchema,
  hierarchicalLookupResponseSchema,
  listLmConnectionsResponseSchema,
  listMcpProfilesResponseSchema,
  listModelConfigsResponseSchema,
  listSessionsResponseSchema,
  preludeStreamEventSchema,
  turnStreamEventSchema,
  sessionTraceBundleSchema,
  sessionCreationDefaultsResponseSchema,
  upsertLmConnectionResponseSchema,
  upsertMcpProfileResponseSchema,
  upsertModelConfigResponseSchema,
  listAnalysisProfilesResponseSchema,
  upsertAnalysisProfileResponseSchema,
  analysisDefaultsResponseSchema,
  launchAnalysisResponseSchema,
  type LmStudioConnection,
  type McpProfileSnapshot,
  type McpServerProfile,
  type ModelConfig,
  type ModelProfileSnapshot,
  type PreludeStreamEvent,
  type SessionCreationDefaults,
  type SessionTraceBundle,
  type HierarchicalLookupResponse,
  type TurnStreamEvent,
  type AnalysisProfile,
  type AnalysisDefaults,
  analysisStreamEventSchema,
  type AnalysisStreamEvent,
} from '../backendTypes'
import { AppError } from '../errors'

const apiBase = (import.meta.env.VITE_BACKEND_API_BASE ?? '').replace(/\/$/, '')

function buildUrl(path: string): string {
  return `${apiBase}${path}`
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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
    // Parse the new structured error shape { error: { type, message, code?, details? } }
    const errorObj = (
      payload
      && typeof payload === 'object'
      && 'error' in payload
      && payload.error !== null
      && typeof payload.error === 'object'
    ) ? payload.error as { type?: string; message?: string; code?: string; details?: unknown } : null

    const message = errorObj?.message ?? (
      typeof payload?.error === 'string' ? payload.error : `Backend request failed (${response.status})`
    )
    const errorType = (errorObj?.type as AppError['errorType']) ?? 'internal'
    throw new AppError(message, errorType, response.status, {
      code: errorObj?.code,
      details: errorObj?.details,
    })
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

export function listSessions(options?: { includeChildren?: boolean }) {
  const url = options?.includeChildren ? '/api/sessions?include_children=true' : '/api/sessions'
  return request(url, {
    schema: listSessionsResponseSchema,
  })
}

export function getSessionTrace(sessionId: string) {
  return request(`/api/sessions/${sessionId}/trace`, {
    schema: sessionTraceBundleSchema,
  })
}

export function createSession(input: {
  sessionId?: string
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

export function lookupByHierarchicalId(id: string, mode: 'summary' | 'full'): Promise<HierarchicalLookupResponse> {
  const encodedId = encodeURIComponent(id)
  return request(`/api/lookup/${encodedId}?mode=${mode}`, {
    schema: hierarchicalLookupResponseSchema,
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

const lmConnectionTestResponseSchema = z.object({ models: z.array(z.string()) })

export function testLmConnection(baseUrl: string, apiKey?: string | null) {
  return request('/api/lm-connections/test', {
    method: 'POST',
    body: { baseUrl, apiKey: apiKey ?? null },
    schema: lmConnectionTestResponseSchema,
  })
}

const lmConnectionModelSchema = z.object({
  uid: z.string(),
  key: z.string(),
  displayName: z.string(),
  maxContextLength: z.number().nullable(),
  loadedContextLength: z.number().nullable(),
  isLoaded: z.boolean(),
  supportsReasoning: z.boolean(),
  defaultReasoningOn: z.boolean(),
  raw: z.unknown(),
})

const lmConnectionModelsResponseSchema = z.object({ models: z.array(lmConnectionModelSchema) })

export type LmConnectionModel = z.infer<typeof lmConnectionModelSchema>

export function listLmConnectionModels(baseUrl: string, apiKey?: string | null) {
  return request('/api/lm-connections/models', {
    method: 'POST',
    body: { baseUrl, apiKey: apiKey ?? null },
    schema: lmConnectionModelsResponseSchema,
  })
}

const lmConnectionModelMutationResponseSchema = z.object({ ok: z.literal(true) })

export function loadLmConnectionModel(baseUrl: string, modelKey: string, apiKey?: string | null) {
  return request('/api/lm-connections/models/load', {
    method: 'POST',
    body: { baseUrl, modelKey, apiKey: apiKey ?? null },
    schema: lmConnectionModelMutationResponseSchema,
  })
}

export function unloadLmConnectionModel(baseUrl: string, instanceId: string, apiKey?: string | null) {
  return request('/api/lm-connections/models/unload', {
    method: 'POST',
    body: { baseUrl, instanceId, apiKey: apiKey ?? null },
    schema: lmConnectionModelMutationResponseSchema,
  })
}

const mcpTestResponseSchema = z.object({
  serverName: z.string(),
  serverVersion: z.string(),
  tools: z.array(z.string()),
})

export function testMcpProfile(url: string) {
  return request('/api/mcp-profiles/test', {
    method: 'POST',
    body: { url },
    schema: mcpTestResponseSchema,
  })
}

const preflightResponseSchema = z.object({ ok: z.literal(true) })

export function preflightSession(input: {
  lmConnectionSnapshot: { baseUrl: string; apiKey?: string | null }
  mcpProfileSnapshot?: { url: string } | null
  selectedModel: { modelKey: string; modelDisplayName?: string }
}) {
  return request('/api/sessions/preflight', {
    method: 'POST',
    body: input,
    schema: preflightResponseSchema,
  })
}

export function getSessionCreationDefaults() {
  return request('/api/session-creation-defaults', {
    schema: sessionCreationDefaultsResponseSchema,
  })
}

export function putSessionCreationDefaults(input: {
  defaultModelConfigId: string | null
  defaultMcpProfileId: string | null
}): Promise<{ sessionCreationDefaults: SessionCreationDefaults }> {
  return request('/api/session-creation-defaults', {
    method: 'PUT',
    body: input,
    schema: sessionCreationDefaultsResponseSchema,
  })
}

export function listAnalysisProfiles() {
  return request('/api/analysis-profiles', {
    schema: listAnalysisProfilesResponseSchema,
  })
}

export function upsertAnalysisProfile(profile: AnalysisProfile) {
  return request(`/api/analysis-profiles/${profile.id}`, {
    method: 'PUT',
    body: profile,
    schema: upsertAnalysisProfileResponseSchema,
  })
}

export function deleteAnalysisProfile(profileId: string) {
  return request<void>(`/api/analysis-profiles/${profileId}`, {
    method: 'DELETE',
  })
}

export function getAnalysisDefaults(): Promise<{ analysisDefaults: AnalysisDefaults }> {
  return request('/api/analysis-defaults', {
    schema: analysisDefaultsResponseSchema,
  })
}

export function putAnalysisDefaults(input: {
  defaultAnalysisProfileId: string | null
}): Promise<{ analysisDefaults: AnalysisDefaults }> {
  return request('/api/analysis-defaults', {
    method: 'PUT',
    body: input,
    schema: analysisDefaultsResponseSchema,
  })
}

export function launchAnalysis(
  targetSessionId: string,
  input: { target_turn_id: string; analysis_goal: string; analysis_profile_id?: string },
) {
  return request(`/api/sessions/${targetSessionId}/analyze`, {
    method: 'POST',
    body: input,
    schema: launchAnalysisResponseSchema,
  })
}

export async function streamExecuteAnalysis(
  analysisSessionId: string,
  onEvent: (event: AnalysisStreamEvent) => void | Promise<void>,
  options: { singleStep?: boolean } = {},
): Promise<void> {
  const url = options.singleStep
    ? buildUrl(`/api/sessions/${analysisSessionId}/execute?single_step=true`)
    : buildUrl(`/api/sessions/${analysisSessionId}/execute`)
  const response = await fetch(url, {
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
        const event = analysisStreamEventSchema.parse(JSON.parse(parsed.dataText))
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
    const event = analysisStreamEventSchema.parse(JSON.parse(trailing.dataText))
    await onEvent(event)
  }
}
