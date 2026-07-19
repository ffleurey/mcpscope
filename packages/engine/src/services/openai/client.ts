/**
 * Shared OpenAI-compatible API client.
 *
 * Contains generic OAI types and functions that work with any provider that
 * exposes an OpenAI-compatible REST API (LM Studio, OpenRouter, Ollama, etc.).
 *
 * Provider-specific functions (native model listing, load/unload, reasoning
 * toggle) live in their respective provider directories.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared OAI types
// ─────────────────────────────────────────────────────────────────────────────

export interface OaiModelListResponse {
  data?: Array<{
    id?: string
    object?: string
    owned_by?: string
    /** Context window size in tokens. Returned by OpenRouter and some other providers. */
    context_length?: number
    /** API parameters this model supports (e.g. "tools", "reasoning"). OpenRouter-specific. */
    supported_parameters?: string[]
  }>
}

export interface OaiChatCompletionUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  reasoning_tokens?: number
  completion_tokens_details?: {
    reasoning_tokens?: number
  }
}

export interface OaiChatCompletionResponse {
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
      reasoning?: string | null // OpenRouter non-streaming
      thinking?: string | null // Ollama OAI-compat non-streaming
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
  usage?: OaiChatCompletionUsage
}

export interface OaiChatCompletionChunk {
  id?: string
  model?: string
  created?: number
  choices?: Array<{
    index?: number
    delta?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null // OpenRouter streaming
      thinking?: string | null // Ollama OAI-compat streaming
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
  usage?: OaiChatCompletionUsage
}

export type AssistantSegment =
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

export interface OaiStreamedChatCompletionResult {
  completion: OaiChatCompletionResponse
  segments: AssistantSegment[]
  rawResponseBody: string
  chunks: OaiChatCompletionChunk[]
}

export type StreamDelta =
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

export interface StreamCallbacks {
  onDelta?(delta: StreamDelta): void
}

export interface ProbeRawExchange {
  requestUrl: string
  requestMethod: string
  requestHeadersJson: Record<string, string> | null
  requestBody: string | null
  responseStatus: number | null
  responseHeadersJson: Record<string, string> | null
  responseBody: string | null
}

export interface PromptProbeResult {
  promptTokens: number | null
  completion: OaiChatCompletionResponse
  rawExchange: ProbeRawExchange
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildUrl(baseUrl: string, relativePath: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(relativePath, normalizedBaseUrl).toString()
}

/**
 * Extract reasoning content from a streaming delta or response message.
 *
 * Different providers use different field names for reasoning/thinking content:
 * - OpenAI standard / LM Studio: `reasoning_content`
 * - OpenRouter streaming: `reasoning`
 * - Ollama (native format via OAI-compat): `thinking`
 *
 * This helper checks all known field names so the parser is provider-agnostic.
 */
export function extractReasoningContent(
  obj: Record<string, unknown> | undefined | null,
): string | null {
  if (!obj) return null
  const rc = obj['reasoning_content']
  if (typeof rc === 'string' && rc.length > 0) return rc
  const r = obj['reasoning']
  if (typeof r === 'string' && r.length > 0) return r
  const t = obj['thinking']
  if (typeof t === 'string' && t.length > 0) return t
  return null
}

/** Strips any path component from baseUrl and returns the scheme+host root. */
export function rootUrl(baseUrl: string): string {
  const u = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  return `${u.protocol}//${u.host}`
}

export function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

function responseHeadersJson(headers: Headers): Record<string, string> | null {
  const contentType = headers.get('content-type')
  return contentType ? { 'content-type': contentType } : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Model listing (OAI-compatible /v1/models endpoint)
// ─────────────────────────────────────────────────────────────────────────────

export async function listModels(baseUrl: string, apiKey?: string): Promise<OaiModelListResponse> {
  const response = await fetch(buildUrl(baseUrl, 'models'), {
    headers: {
      Accept: 'application/json',
      ...authHeaders(apiKey),
    },
  })

  if (!response.ok) {
    throw new Error(`Models request failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as OaiModelListResponse
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat completion (non-streaming)
// ─────────────────────────────────────────────────────────────────────────────

export async function createChatCompletion(
  baseUrl: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OaiChatCompletionResponse> {
  const response = await fetch(buildUrl(baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders(apiKey),
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Completion failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
    )
  }

  return (await response.json()) as OaiChatCompletionResponse
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE stream parsing
// ─────────────────────────────────────────────────────────────────────────────

function appendTextSegment(
  segments: AssistantSegment[],
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

function appendToolCallSegment(segments: AssistantSegment[], toolCallIndex: number): void {
  const lastSegment = segments.at(-1)
  if (lastSegment?.kind === 'tool-call' && lastSegment.toolCallIndex === toolCallIndex) {
    return
  }

  segments.push({
    kind: 'tool-call',
    toolCallIndex,
  })
}

/**
 * Split raw SSE text into individual data payloads, one per blank-line boundary.
 * Shared by the streaming-completion parser and the provider token-usage
 * normalizer (services/provider/tokenUsage.ts).
 */
export function parseServerSentEventPayloads(rawText: string): string[] {
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

/**
 * Parse one SSE data payload as a completion chunk, or null if malformed.
 * Providers under load emit occasional truncated/garbled payloads; skipping a
 * bad chunk (like normalizeStreamUsage does) beats aborting the whole turn.
 */
function parseChunkPayload(payload: string): OaiChatCompletionChunk | null {
  try {
    return JSON.parse(payload) as OaiChatCompletionChunk
  } catch {
    return null
  }
}

export function parseChatCompletionStream(rawText: string): OaiStreamedChatCompletionResult {
  const payloads = parseServerSentEventPayloads(rawText)
  const chunks: OaiChatCompletionChunk[] = []
  const segments: AssistantSegment[] = []
  const toolCalls = new Map<
    number,
    {
      id?: string
      type?: string
      function: {
        name: string
        arguments: string
      }
    }
  >()

  let id = ''
  let model = ''
  let created = 0
  let finishReason: string | null = null
  let role = 'assistant'
  let content = ''
  let reasoningContent = ''
  let usage: OaiChatCompletionUsage | undefined

  for (const payload of payloads) {
    if (payload === '[DONE]') {
      continue
    }

    const chunk = parseChunkPayload(payload)
    if (!chunk) continue // one corrupt payload must not discard the whole turn
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

    const rc = extractReasoningContent(delta as unknown as Record<string, unknown>)
    if (rc) {
      reasoningContent += rc
      appendTextSegment(segments, 'reasoning', rc)
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

        if (typeof toolCallDelta.id === 'string' && record.id === undefined) {
          // First-wins: providers that repeat the full id in every chunk must
          // not produce a doubled id (only name/arguments stream as fragments).
          record.id = toolCallDelta.id
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
      type: toolCall.type ?? 'function',
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
  chunk: OaiChatCompletionChunk,
  onDelta: ((delta: StreamDelta) => void) | undefined,
): void {
  if (!onDelta) {
    return
  }

  const delta = chunk.choices?.[0]?.delta
  if (!delta) {
    return
  }

  const rc = extractReasoningContent(delta as unknown as Record<string, unknown>)
  if (rc) {
    onDelta({
      kind: 'reasoning',
      textDelta: rc,
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
        ...(typeof toolCallDelta.function?.name === 'string'
          ? { nameDelta: toolCallDelta.function.name }
          : {}),
        ...(typeof toolCallDelta.function?.arguments === 'string'
          ? { argumentsDelta: toolCallDelta.function.arguments }
          : {}),
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming chat completion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when the SSE reader fails mid-stream (network drop, upstream reset,
 * abort). Unlike a bare fetch error, this carries whatever the model already
 * streamed — `partial` is the best-effort parse of the bytes received before
 * the failure — so callers can persist the partial answer instead of losing
 * it, and `receivedBytes` distinguishes a zero-byte failure from one that
 * happened deep into a response.
 */
export class StreamReadError extends Error {
  constructor(
    message: string,
    readonly receivedBytes: number,
    readonly partial: OaiStreamedChatCompletionResult,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'StreamReadError'
  }
}

export async function streamChatCompletion(
  baseUrl: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
  callbacks?: StreamCallbacks,
  signal?: AbortSignal,
): Promise<OaiStreamedChatCompletionResult> {
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
    ...(signal ? { signal } : {}),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Streamed completion failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
    )
  }

  if (!response.body) {
    const rawText = await response.text()
    const parsed = parseChatCompletionStream(rawText)
    parsed.chunks.forEach((chunk) => emitChunkDeltas(chunk, callbacks?.onDelta))
    return parsed
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let rawText = ''
  let buffered = ''
  let currentDataLines: string[] = []
  let receivedBytes = 0

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
          const chunk = parseChunkPayload(payload)
          if (chunk) emitChunkDeltas(chunk, callbacks?.onDelta)
        }
        continue
      }

      if (line.startsWith('data:')) {
        currentDataLines.push(line.slice(5).trimStart())
      }
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }

      receivedBytes += value.byteLength
      const text = decoder.decode(value, { stream: true })
      rawText += text
      buffered += text
      processBufferedLines()
    }
  } catch (err) {
    // Release the response body on a mid-stream failure (abort, network drop)
    // so the connection isn't left dangling. Reparse whatever text made it
    // through before the failure: the model may already have streamed a full
    // reasoning/content answer, and the caller should be able to recover it
    // instead of discarding it along with the error.
    void reader.cancel().catch(() => {})
    const causeMessage = err instanceof Error ? err.message : String(err)
    throw new StreamReadError(
      `Stream reading failed after ${receivedBytes} byte${receivedBytes === 1 ? '' : 's'}: ${causeMessage}`,
      receivedBytes,
      parseChatCompletionStream(rawText),
      { cause: err },
    )
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
      const chunk = parseChunkPayload(payload)
      if (chunk) emitChunkDeltas(chunk, callbacks?.onDelta)
    }
  }

  return parseChatCompletionStream(rawText)
}

// ─────────────────────────────────────────────────────────────────────────────
// Token probing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error carrying the upstream HTTP status, so callers can distinguish a semantic
 * request rejection (e.g. a 400 from OpenRouter when `max_tokens: 1` would
 * truncate a tool call) from transport/auth failures that must still surface.
 */
export class ProviderResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderResponseError'
  }
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
): Promise<PromptProbeResult> {
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
    throw new ProviderResponseError(
      response.status,
      `Completion failed: ${response.status} ${response.statusText}: ${responseText.slice(0, 500)}`,
    )
  }

  const completion = JSON.parse(responseText) as OaiChatCompletionResponse

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
