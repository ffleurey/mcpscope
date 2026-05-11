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

export async function streamChatCompletion(
  baseUrl: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
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

  const rawText = await response.text()
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
