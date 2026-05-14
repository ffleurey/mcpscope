export interface LmStudioModelListResponse {
  data?: Array<{
    id?: string
    object?: string
    owned_by?: string
  }>
}

export interface LmStudioChatCompletionUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  reasoning_tokens?: number
  completion_tokens_details?: {
    reasoning_tokens?: number
  }
}

export interface LmStudioChatCompletionResponse {
  id: string
  model: string
  created: number
  choices: Array<{
    index: number
    finish_reason: string | null
    message?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
  usage?: LmStudioChatCompletionUsage
}

export interface LmStudioChatCompletionChunk {
  id?: string
  model?: string
  created?: number
  choices?: Array<{
    index?: number
    delta?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: LmStudioChatCompletionUsage
}

export type LmStudioAssistantSegment =
  | {
      kind: 'reasoning'
      text: string
    }
  | {
      kind: 'content'
      text: string
    }
  | {
      kind: 'tool-call'
      toolCallIndex: number
    }

export interface LmStudioStreamedChatCompletionResult {
  completion: LmStudioChatCompletionResponse
  segments: LmStudioAssistantSegment[]
  rawResponseBody: string
  chunks: LmStudioChatCompletionChunk[]
}

export type LmStudioStreamDelta =
  | {
      kind: 'reasoning'
      textDelta: string
    }
  | {
      kind: 'content'
      textDelta: string
    }
  | {
      kind: 'tool-call'
      toolCallIndex: number
      idDelta?: string | undefined
      nameDelta?: string | undefined
      argumentsDelta?: string | undefined
    }

export interface LmStudioStreamCallbacks {
  onDelta?(delta: LmStudioStreamDelta): void
}

export interface LmStudioRawExchange {
  requestUrl: string
  requestMethod: string
  requestHeadersJson: Record<string, string> | null
  requestBody: string | null
  responseStatus: number | null
  responseHeadersJson: Record<string, string> | null
  responseBody: string | null
}

export interface LmStudioPromptProbeResult {
  promptTokens: number | null
  completion: LmStudioChatCompletionResponse
  rawExchange: LmStudioRawExchange
}

function buildUrl(baseUrl: string, relativePath: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(relativePath, normalizedBaseUrl).toString()
}

/** Strips any path component from baseUrl and returns the scheme+host root. */
function rootUrl(baseUrl: string): string {
  const u = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  return `${u.protocol}//${u.host}`
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

function responseHeadersJson(headers: Headers): Record<string, string> | null {
  const contentType = headers.get('content-type')
  return contentType ? { 'content-type': contentType } : null
}

export async function listModels(baseUrl: string, apiKey?: string): Promise<LmStudioModelListResponse> {
  const response = await fetch(buildUrl(baseUrl, 'models'), {
    headers: {
      Accept: 'application/json',
      ...authHeaders(apiKey),
    },
  })

  if (!response.ok) {
    throw new Error(`LM Studio models request failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as LmStudioModelListResponse
}

export interface LmStudioNativeModel {
  type?: string
  key?: string
  display_name?: string
  max_context_length?: number
  capabilities?: {
    reasoning?: {
      allowed_options?: string[]
      default?: string
    }
  }
  loaded_instances?: Array<{
    id?: string
    config?: {
      context_length?: number
    }
  }>
}

export interface LmStudioModelStatus {
  uid: string
  key: string
  displayName: string
  maxContextLength: number | null
  loadedContextLength: number | null
  isLoaded: boolean
  supportsReasoning: boolean
  defaultReasoningOn: boolean
  raw: LmStudioNativeModel
}

async function listNativeLlmModels(baseUrl: string, apiKey?: string): Promise<LmStudioNativeModel[] | null> {
  try {
    const url = `${rootUrl(baseUrl)}/api/v1/models`
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...authHeaders(apiKey) },
    })
    if (!response.ok) return null
    const data = (await response.json()) as { models?: LmStudioNativeModel[] }
    return (data.models ?? []).filter(m => m.type === 'llm' && typeof m.key === 'string')
  } catch {
    return null
  }
}

export async function listModelsWithStatus(baseUrl: string, apiKey?: string): Promise<LmStudioModelStatus[]> {
  const nativeModels = await listNativeLlmModels(baseUrl, apiKey)
  if (nativeModels && nativeModels.length > 0) {
    return nativeModels.map((m) => {
      const displayName = m.display_name ?? m.key ?? ''
      const loadedInstance = m.loaded_instances?.[0]
      const reasoningOptions = m.capabilities?.reasoning?.allowed_options ?? []
      const supportsReasoning = reasoningOptions.includes('on') && reasoningOptions.includes('off')
      return {
        uid: `${m.key}:${displayName}`,
        key: m.key ?? '',
        displayName,
        maxContextLength: m.max_context_length ?? null,
        loadedContextLength: loadedInstance?.config?.context_length ?? null,
        isLoaded: (m.loaded_instances?.length ?? 0) > 0,
        supportsReasoning,
        defaultReasoningOn: m.capabilities?.reasoning?.default === 'on',
        raw: m,
      }
    })
  }

  const compat = await listModels(baseUrl, apiKey)
  const ids = compat.data?.map(m => m.id ?? '').filter(Boolean) ?? []
  return ids.map((id) => ({
    uid: id,
    key: id,
    displayName: id,
    maxContextLength: null,
    loadedContextLength: null,
    isLoaded: false,
    supportsReasoning: false,
    defaultReasoningOn: false,
    raw: { type: 'llm', key: id },
  }))
}

/**
 * Returns whether `modelKey` currently has at least one loaded instance.
 * Returns null if the native model endpoint cannot be queried.
 */
export async function isModelLoaded(
  baseUrl: string,
  apiKey: string | undefined,
  modelKey: string,
): Promise<boolean | null> {
  const models = await listNativeLlmModels(baseUrl, apiKey)
  if (!models) return null
  const model = models.find(m => m.key === modelKey)
  if (!model) return false
  return (model.loaded_instances?.length ?? 0) > 0
}

/**
 * Returns the loaded context window size for the currently-loaded instance of
 * `modelKey`, or null if the native API is unavailable or the model is not loaded.
 *
 * Uses the LM Studio native /api/v1/models endpoint (not the OpenAI-compat one).
 */
export async function getLoadedContextLength(
  baseUrl: string,
  apiKey: string | undefined,
  modelKey: string,
): Promise<number | null> {
  const models = await listNativeLlmModels(baseUrl, apiKey)
  if (!models) return null
  const model = models.find(m => m.key === modelKey)
  return model?.loaded_instances?.[0]?.config?.context_length ?? null
}

export async function loadModel(
  baseUrl: string,
  apiKey: string | undefined,
  modelKey: string,
): Promise<void> {
  const url = `${rootUrl(baseUrl)}/api/v1/models/load`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders(apiKey),
    },
    body: JSON.stringify({ model: modelKey }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LM Studio load model failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
  }
}

export async function unloadModel(
  baseUrl: string,
  apiKey: string | undefined,
  instanceId: string,
): Promise<void> {
  const url = `${rootUrl(baseUrl)}/api/v1/models/unload`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders(apiKey),
    },
    body: JSON.stringify({ instance_id: instanceId }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LM Studio unload model failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
  }
}

export async function createChatCompletion(
  baseUrl: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
): Promise<LmStudioChatCompletionResponse> {
  const response = await fetch(buildUrl(baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders(apiKey),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LM Studio completion failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
  }

  return (await response.json()) as LmStudioChatCompletionResponse
}

function appendTextSegment(
  segments: LmStudioAssistantSegment[],
  kind: 'reasoning' | 'content',
  text: string | null | undefined,
): void {
  if (!text) {
    return
  }

  const lastSegment = segments.at(-1)
  if (lastSegment?.kind === kind) {
    lastSegment.text += text
    return
  }

  segments.push({ kind, text })
}

function appendToolCallSegment(
  segments: LmStudioAssistantSegment[],
  toolCallIndex: number,
): void {
  const lastSegment = segments.at(-1)
  if (lastSegment?.kind === 'tool-call' && lastSegment.toolCallIndex === toolCallIndex) {
    return
  }

  segments.push({
    kind: 'tool-call',
    toolCallIndex,
  })
}

function parseServerSentEventPayloads(rawText: string): string[] {
  const payloads: string[] = []
  let currentDataLines: string[] = []

  for (const rawLine of rawText.split(/\r?\n/)) {
    if (rawLine.length === 0) {
      if (currentDataLines.length > 0) {
        payloads.push(currentDataLines.join('\n'))
        currentDataLines = []
      }
      continue
    }

    if (rawLine.startsWith('data:')) {
      currentDataLines.push(rawLine.slice(5).trimStart())
    }
  }

  if (currentDataLines.length > 0) {
    payloads.push(currentDataLines.join('\n'))
  }

  return payloads
}

export function parseChatCompletionStream(
  rawText: string,
): LmStudioStreamedChatCompletionResult {
  const payloads = parseServerSentEventPayloads(rawText)
  const chunks: LmStudioChatCompletionChunk[] = []
  const segments: LmStudioAssistantSegment[] = []
  const toolCalls = new Map<number, {
    id?: string
    type?: string
    function: {
      name: string
      arguments: string
    }
  }>()

  let id = ''
  let model = ''
  let created = 0
  let finishReason: string | null = null
  let role = 'assistant'
  let content = ''
  let reasoningContent = ''
  let usage: LmStudioChatCompletionUsage | undefined

  for (const payload of payloads) {
    if (payload === '[DONE]') {
      continue
    }

    const chunk = JSON.parse(payload) as LmStudioChatCompletionChunk
    chunks.push(chunk)

    id = chunk.id ?? id
    model = chunk.model ?? model
    created = chunk.created ?? created
    usage = chunk.usage ?? usage

    const choice = chunk.choices?.[0]
    if (!choice) {
      continue
    }

    finishReason = choice.finish_reason ?? finishReason
    const delta = choice.delta
    if (!delta) {
      continue
    }

    role = delta.role ?? role

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      reasoningContent += delta.reasoning_content
      appendTextSegment(segments, 'reasoning', delta.reasoning_content)
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content
      appendTextSegment(segments, 'content', delta.content)
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const toolCallDelta of delta.tool_calls) {
        const toolCallIndex = toolCallDelta.index ?? 0
        const record = toolCalls.get(toolCallIndex) ?? {
          function: {
            name: '',
            arguments: '',
          },
        }

        if (typeof toolCallDelta.id === 'string') {
          record.id = `${record.id ?? ''}${toolCallDelta.id}`
        }
        if (typeof toolCallDelta.type === 'string') {
          record.type = toolCallDelta.type
        }
        if (typeof toolCallDelta.function?.name === 'string') {
          record.function.name += toolCallDelta.function.name
        }
        if (typeof toolCallDelta.function?.arguments === 'string') {
          record.function.arguments += toolCallDelta.function.arguments
        }

        toolCalls.set(toolCallIndex, record)
        appendToolCallSegment(segments, toolCallIndex)
      }
    }
  }

  const orderedToolCalls = [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, toolCall]) => ({
      id: toolCall.id ?? `tool-call-${index}`,
      type: (toolCall.type ?? 'function'),
      function: {
        name: toolCall.function.name || 'unknown',
        arguments: toolCall.function.arguments || '{}',
      },
    }))

  return {
    completion: {
      id,
      model,
      created,
      choices: [
        {
          index: 0,
          finish_reason: finishReason,
          message: {
            role,
            content: content || null,
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
            ...(orderedToolCalls.length > 0 ? { tool_calls: orderedToolCalls } : {}),
          },
        },
      ],
      ...(usage ? { usage } : {}),
    },
    segments,
    rawResponseBody: rawText,
    chunks,
  }
}

function emitChunkDeltas(
  chunk: LmStudioChatCompletionChunk,
  onDelta: ((delta: LmStudioStreamDelta) => void) | undefined,
): void {
  if (!onDelta) {
    return
  }

  const delta = chunk.choices?.[0]?.delta
  if (!delta) {
    return
  }

  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    onDelta({
      kind: 'reasoning',
      textDelta: delta.reasoning_content,
    })
  }

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    onDelta({
      kind: 'content',
      textDelta: delta.content,
    })
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const toolCallDelta of delta.tool_calls) {
      onDelta({
        kind: 'tool-call',
        toolCallIndex: toolCallDelta.index ?? 0,
        ...(typeof toolCallDelta.id === 'string' ? { idDelta: toolCallDelta.id } : {}),
        ...(typeof toolCallDelta.function?.name === 'string' ? { nameDelta: toolCallDelta.function.name } : {}),
        ...(typeof toolCallDelta.function?.arguments === 'string' ? { argumentsDelta: toolCallDelta.function.arguments } : {}),
      })
    }
  }
}

export async function streamChatCompletion(
  baseUrl: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
  callbacks?: LmStudioStreamCallbacks,
): Promise<LmStudioStreamedChatCompletionResult> {
  const response = await fetch(buildUrl(baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeaders(apiKey),
    },
    body: JSON.stringify({
      ...body,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LM Studio streamed completion failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
  }

  if (!response.body) {
    const rawText = await response.text()
    const parsed = parseChatCompletionStream(rawText)
    parsed.chunks.forEach(chunk => emitChunkDeltas(chunk, callbacks?.onDelta))
    return parsed
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let rawText = ''
  let buffered = ''
  let currentDataLines: string[] = []

  const processBufferedLines = () => {
    while (true) {
      const newlineIndex = buffered.indexOf('\n')
      if (newlineIndex < 0) {
        return
      }

      const rawLine = buffered.slice(0, newlineIndex)
      buffered = buffered.slice(newlineIndex + 1)
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

      if (line.length === 0) {
        if (currentDataLines.length === 0) {
          continue
        }
        const payload = currentDataLines.join('\n')
        currentDataLines = []
        if (payload !== '[DONE]') {
          emitChunkDeltas(JSON.parse(payload) as LmStudioChatCompletionChunk, callbacks?.onDelta)
        }
        continue
      }

      if (line.startsWith('data:')) {
        currentDataLines.push(line.slice(5).trimStart())
      }
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    const text = decoder.decode(value, { stream: true })
    rawText += text
    buffered += text
    processBufferedLines()
  }

  const finalChunk = decoder.decode()
  rawText += finalChunk
  buffered += finalChunk
  processBufferedLines()

  if (buffered.length > 0) {
    const line = buffered.endsWith('\r') ? buffered.slice(0, -1) : buffered
    if (line.startsWith('data:')) {
      currentDataLines.push(line.slice(5).trimStart())
    }
  }
  if (currentDataLines.length > 0) {
    const payload = currentDataLines.join('\n')
    if (payload !== '[DONE]') {
      emitChunkDeltas(JSON.parse(payload) as LmStudioChatCompletionChunk, callbacks?.onDelta)
    }
  }

  return parseChatCompletionStream(rawText)
}

export async function probePromptTokens(
  baseUrl: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
): Promise<number | null> {
  const result = await probePromptTokensDetailed(baseUrl, apiKey, body)
  return result.promptTokens
}

export async function probePromptTokensDetailed(
  baseUrl: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
): Promise<LmStudioPromptProbeResult> {
  const requestBody = {
    ...body,
    stream: false,
    max_tokens: 1,
  }
  const requestUrl = buildUrl(baseUrl, 'chat/completions')
  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const requestBodyText = JSON.stringify(requestBody)
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      ...requestHeaders,
      ...authHeaders(apiKey),
    },
    body: requestBodyText,
  })

  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`LM Studio completion failed: ${response.status} ${response.statusText}: ${responseText.slice(0, 500)}`)
  }

  const completion = JSON.parse(responseText) as LmStudioChatCompletionResponse

  return {
    promptTokens: completion.usage?.prompt_tokens ?? null,
    completion,
    rawExchange: {
      requestUrl,
      requestMethod: 'POST',
      requestHeadersJson: requestHeaders,
      requestBody: requestBodyText,
      responseStatus: response.status,
      responseHeadersJson: responseHeadersJson(response.headers),
      responseBody: responseText,
    },
  }
}
