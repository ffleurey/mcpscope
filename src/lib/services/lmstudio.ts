import type { ConnectionTestResult } from '../types'

// LM Studio 0.4+ native model shape from /api/v1/models
export interface LmStudioNativeModel {
  type: string
  key: string
  display_name?: string
  publisher?: string
  architecture?: string
  quantization?: { name?: string; bits_per_weight?: number }
  size_bytes?: number
  params_string?: string
  max_context_length?: number
  format?: string
  loaded_instances?: {
    id: string
    config: {
      context_length: number
      eval_batch_size?: number
      parallel?: number
      flash_attention?: boolean
      offload_kv_cache_to_gpu?: boolean
    }
    remaining_ttl_seconds?: number
  }[]
  capabilities?: {
    vision?: boolean
    trained_for_tool_use?: boolean
    reasoning?: {
      allowed_options?: string[]
      default?: string
    }
  }
  variants?: string[]
  selected_variant?: string
}

export interface LmStudioModel {
  uid: string                         // unique per entry: key + ':' + displayName (for {#each})
  key: string                         // model key sent to the API (may repeat across cluster nodes)
  displayName: string
  maxContextLength: number | null     // model's architectural maximum
  loadedContextLength: number | null  // actual context when loaded (may be much smaller)
  isLoaded: boolean
  supportsReasoning: boolean
  defaultReasoningOn: boolean
  raw: LmStudioNativeModel            // full native API response for this model
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

export async function listModels(baseUrl: string, apiKey?: string): Promise<LmStudioModel[]> {
  const root = rootUrl(baseUrl)
  const nativeUrl = `${root}/api/v1/models`
  const compatUrl = `${root}/v1/models`

  try {
    let data: unknown = null
    let usedNative = false

    try {
      const r = await fetch(nativeUrl, { headers: { Accept: 'application/json', ...authHeaders(apiKey) } })
      if (r.ok) {
        data = await r.json()
        usedNative = true
      }
    } catch {
      // native endpoint failed; will try compat below
    }

    if (!usedNative) {
      const r = await fetch(compatUrl, { headers: { Accept: 'application/json', ...authHeaders(apiKey) } })
      if (!r.ok) return []
      data = await r.json()
    }

    if (usedNative) {
      const models: LmStudioNativeModel[] = (data as { models?: LmStudioNativeModel[] })?.models ?? []
      return models
        .filter(m => m.type === 'llm')
        .map(m => {
          const displayName = m.display_name ?? m.key
          const loadedInstance = m.loaded_instances?.[0]
          const reasoningOptions = m.capabilities?.reasoning?.allowed_options ?? []
          const supportsReasoning = reasoningOptions.includes('on') && reasoningOptions.includes('off')
          return {
            uid: `${m.key}:${displayName}`,
            key: m.key,
            displayName,
            maxContextLength: m.max_context_length ?? null,
            loadedContextLength: loadedInstance?.config.context_length ?? null,
            isLoaded: Array.isArray(m.loaded_instances) && m.loaded_instances.length > 0,
            supportsReasoning,
            defaultReasoningOn: m.capabilities?.reasoning?.default === 'on',
            raw: m,
          }
        })
    } else {
      const items: { id?: string }[] = Array.isArray((data as { data?: { id?: string }[] })?.data)
        ? (data as { data: { id?: string }[] }).data
        : []
      return items
        .map(m => m.id ?? '')
        .filter(Boolean)
        .map(id => ({
          uid: id,
          key: id,
          displayName: id,
          maxContextLength: null,
          loadedContextLength: null,
          isLoaded: false,
          supportsReasoning: false,
          defaultReasoningOn: false,
          raw: { type: 'llm', key: id } as LmStudioNativeModel,
        }))
    }
  } catch {
    return []
  }
}

// Derive the LM Studio root URL from the configured OpenAI-compatible base URL.
// e.g. "http://localhost:1234/v1" → "http://localhost:1234"
// Also handles bare roots like "http://localhost:1234"
function rootUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/$/, '')
  return clean.endsWith('/v1') ? clean.slice(0, -3) : clean
}

export async function testLmStudioConnection(baseUrl: string, apiKey?: string): Promise<ConnectionTestResult> {
  // Prefer the native /api/v1/models endpoint (LM Studio 0.4+): richer data including
  // max_context_length. Fall back to the OpenAI-compatible /v1/models endpoint.
  const root = rootUrl(baseUrl)
  const nativeUrl = `${root}/api/v1/models`
  const compatUrl = `${root}/v1/models`

  try {
    // Try native endpoint first
    let data: unknown = null
    let usedNative = false

    try {
      const r = await fetch(nativeUrl, { headers: { Accept: 'application/json', ...authHeaders(apiKey) } })
      if (r.ok) {
        data = await r.json()
        usedNative = true
      }
    } catch {
      // native endpoint failed; will try compat below
    }

    if (!usedNative) {
      const r = await fetch(compatUrl, { headers: { Accept: 'application/json', ...authHeaders(apiKey) } })
      if (!r.ok) {
        let body = ''
        try { body = await r.text() } catch {}
        return {
          status: 'error',
          message: `Server returned ${r.status} ${r.statusText}`,
          details: body ? [body.slice(0, 300)] : [],
        }
      }
      data = await r.json()
    }

    const details: string[] = []

    if (usedNative) {
      const models: LmStudioNativeModel[] = (data as { models?: LmStudioNativeModel[] })?.models ?? []
      const llms = models.filter(m => m.type === 'llm')
      const loaded = llms.filter(m => Array.isArray(m.loaded_instances) && m.loaded_instances.length > 0)

      if (llms.length === 0) {
        details.push('No LLMs found. Load a model in LM Studio first.')
      } else {
        const modelLines = llms.map(m => {
          const loadedInst = m.loaded_instances?.[0]
          const ctxDisplay = loadedInst
            ? ` (${(loadedInst.config.context_length / 1000).toFixed(0)}k loaded)`
            : m.max_context_length
              ? ` (${(m.max_context_length / 1000).toFixed(0)}k max)`
              : ''
          const active = loaded.some(l => l.key === m.key) ? ' [loaded]' : ''
          return `${m.key}${ctxDisplay}${active}`
        })
        details.push(`LLMs: ${modelLines.join(', ')}`)
      }
    } else {
      const modelIds: string[] = Array.isArray((data as { data?: { id?: string }[] })?.data)
        ? ((data as { data: { id?: string }[] }).data).map(m => m.id ?? '').filter(Boolean)
        : []
      details.push(modelIds.length > 0 ? `Models: ${modelIds.join(', ')}` : 'No models found.')
    }

    return { status: 'success', message: 'Connected', details }
  } catch (e) {
    const msg = e instanceof TypeError ? e.message : String(e)
    const looksLikeNetworkBlock =
      msg.toLowerCase().includes('failed to fetch') ||
      msg.toLowerCase().includes('networkerror') ||
      msg.toLowerCase().includes('network request failed') ||
      msg.toLowerCase().includes('load failed')

    if (looksLikeNetworkBlock) {
      return {
        status: 'error',
        message: 'Cannot reach LM Studio — CORS is not enabled on the server.',
        details: [
          'LM Studio requires the --cors flag for browser-based apps.',
          'Stop the server and restart it with CORS enabled:',
          '  lms server stop',
          '  lms server start --cors',
          'Or enable "Allow cross-origin requests" in LM Studio Developer settings.',
        ],
      }
    }

    return {
      status: 'error',
      message: `Network error: ${msg}`,
      details: [],
    }
  }
}

// Probe the token count of a system prompt by sending a minimal completion request.
// Returns the number of tokens in the system prompt, or null on failure.
// If systemPrompt is empty, returns 0 immediately.
export async function probeSystemPromptTokens(
  baseUrl: string,
  modelKey: string,
  systemPrompt: string,
  apiKey?: string
): Promise<number | null> {
  if (!systemPrompt.trim()) return 0
  const url = `${rootUrl(baseUrl)}/v1/chat/completions`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
      body: JSON.stringify({
        model: modelKey,
        messages: [{ role: 'system', content: systemPrompt }],
        max_tokens: 1,
        stream: false,
      }),
    })
    if (!r.ok) return null
    const data = await r.json()
    return data?.usage?.prompt_tokens ?? null
  } catch {
    return null
  }
}

// Probe the accurate token count for tool definitions by sending a minimal request
// that includes the tools[] array. Returns the number of tokens the tools add on top
// of the system prompt, or null if the probe fails.
export async function probeToolDefinitionsTokens(
  baseUrl: string,
  modelKey: string,
  systemPrompt: string,
  tools: LmToolParam[],
  systemPromptTokens: number | null,
  apiKey?: string
): Promise<number | null> {
  if (tools.length === 0) return 0
  const url = `${rootUrl(baseUrl)}/v1/chat/completions`
  try {
    const body: Record<string, unknown> = {
      model: modelKey,
      messages: [
        ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: 'hi' },
      ],
      tools: tools.map(t => ({ type: 'function', function: t.function })),
      max_tokens: 1,
      stream: false,
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    const data = await r.json()
    const total: number | undefined = data?.usage?.prompt_tokens
    if (total == null) return null
    // Subtract system prompt and the single user message (~1 token for "hi")
    const systemCost = systemPromptTokens ?? 0
    return Math.max(0, total - systemCost - 2)
  } catch {
    return null
  }
}

export interface StreamTraceData {
  completionId: string
  model: string
  systemFingerprint: string
  created: number      // Unix seconds (1s precision, same on all chunks)
  finishReason: string
}

// A completed tool call as streamed from the model (arguments accumulate over many chunks)
export interface StreamedToolCall {
  id: string
  name: string
  argumentsJson: string  // complete JSON string when done streaming
}

export interface StreamChunk {
  content: string
  thinking: string
  done: boolean
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number }
  rawUsage?: unknown       // usage object verbatim from API
  traceData?: StreamTraceData  // completion metadata from finish + usage chunks
  finishReason?: string    // forwarded on the done chunk; 'length' = context exhausted, 'tool_calls' = tool use
  toolCalls?: StreamedToolCall[]  // present on done chunk when finishReason === 'tool_calls'
}

// Tool definition formatted for the OpenAI-compatible tools[] array
export interface LmToolParam {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export async function* streamChatCompletion(
  baseUrl: string,
  modelId: string,
  // Allow null content — needed for assistant messages that only contain tool_calls
  messages: { role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string; reasoning_content?: string }[],
  temperature: number,
  apiKey?: string,
  abortSignal?: AbortSignal,
  reasoning?: 'on' | 'off',
  tools?: LmToolParam[]
): AsyncGenerator<StreamChunk> {
  const url = `${rootUrl(baseUrl)}/v1/chat/completions`

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    temperature,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (reasoning !== undefined) {
    body.reasoning = { effort: reasoning === 'on' ? 'high' : 'off' }
  }
  if (tools && tools.length > 0) {
    body.tools = tools
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
    body: JSON.stringify(body),
    signal: abortSignal,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`LM Studio returned ${response.status} ${response.statusText}${body ? ': ' + body.slice(0, 200) : ''}`)
  }

  if (!response.body) {
    throw new Error('Response body is null')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Accumulated trace data across chunks
  let traceData: StreamTraceData | null = null
  let pendingFinishReason: string | null = null

  // Accumulate tool_calls across chunks.
  // Each index maps to a partially-built tool call; id+name only arrive in first chunk for that index.
  const pendingToolCalls: Map<number, { id: string; name: string; argsAccumulator: string }> = new Map()

  try {
    while (true) {
      if (abortSignal?.aborted) return

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()

        if (data === '[DONE]') {
          // Build completed tool calls from accumulated data
          const toolCalls: StreamedToolCall[] = pendingToolCalls.size > 0
            ? [...pendingToolCalls.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, tc]) => ({ id: tc.id, name: tc.name, argumentsJson: tc.argsAccumulator }))
            : undefined as unknown as StreamedToolCall[]

          yield {
            content: '',
            thinking: '',
            done: true,
            finishReason: pendingFinishReason ?? 'stop',
            ...(toolCalls?.length ? { toolCalls } : {}),
          }
          return
        }

        try {
          const parsed = JSON.parse(data)

          // Capture completion metadata from any chunk that has it
          if (parsed?.id && !traceData) {
            traceData = {
              completionId: parsed.id,
              model: parsed.model ?? '',
              systemFingerprint: parsed.system_fingerprint ?? '',
              created: parsed.created ?? 0,
              finishReason: '',  // filled in from finish chunk
            }
          }

          const choices = parsed?.choices ?? []
          const delta = choices[0]?.delta
          const finishReason = choices[0]?.finish_reason

          if (finishReason && finishReason !== 'null') {
            pendingFinishReason = finishReason
            if (traceData) traceData = { ...traceData, finishReason }
          }

          const thinking = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : ''
          const content = typeof delta?.content === 'string' ? delta.content : ''
          if (thinking.length > 0 || content.length > 0) {
            yield { content, thinking, done: false }
          }

          // Accumulate tool_calls deltas.
          // First chunk for each index carries id + function.name; subsequent carry function.arguments fragments.
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx: number = tc.index ?? 0
              if (!pendingToolCalls.has(idx)) {
                pendingToolCalls.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', argsAccumulator: '' })
              }
              const entry = pendingToolCalls.get(idx)!
              if (tc.id && !entry.id) entry.id = tc.id
              if (tc.function?.name && !entry.name) entry.name = tc.function.name
              if (typeof tc.function?.arguments === 'string') {
                entry.argsAccumulator += tc.function.arguments
              }
            }
          }

          // Capture usage chunk (last data event before [DONE])
          if (parsed?.usage) {
            const u = parsed.usage
            const resolvedFinishReason = pendingFinishReason ?? 'stop'
            const toolCalls: StreamedToolCall[] = pendingToolCalls.size > 0
              ? [...pendingToolCalls.entries()]
                  .sort(([a], [b]) => a - b)
                  .map(([, tc]) => ({ id: tc.id, name: tc.name, argumentsJson: tc.argsAccumulator }))
              : undefined as unknown as StreamedToolCall[]

            yield {
              content: '',
              thinking: '',
              done: true,
              finishReason: resolvedFinishReason,
              ...(toolCalls?.length ? { toolCalls } : {}),
              usage: {
                promptTokens: u.prompt_tokens ?? 0,
                completionTokens: u.completion_tokens ?? 0,
                totalTokens: u.total_tokens ?? 0,
                reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? undefined,
              },
              rawUsage: u,
              traceData: traceData ?? {
                completionId: parsed.id ?? '',
                model: parsed.model ?? '',
                systemFingerprint: parsed.system_fingerprint ?? '',
                created: parsed.created ?? 0,
                finishReason: resolvedFinishReason,
              },
            }
            return
          }
        } catch {
          // Malformed chunk — skip
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export interface ModelLoadResult {
  instanceId: string
  status: string
  loadTimeSeconds?: number
}

export async function loadModel(baseUrl: string, modelKey: string, apiKey?: string): Promise<ModelLoadResult> {
  const url = `${rootUrl(baseUrl)}/api/v1/models/load`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
    body: JSON.stringify({ model: modelKey }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`Load failed (${r.status}): ${body.slice(0, 200)}`)
  }
  const data = await r.json()
  return {
    instanceId: data.instance_id ?? modelKey,
    status: data.status ?? 'loaded',
    loadTimeSeconds: data.load_time_seconds,
  }
}

export async function unloadModel(baseUrl: string, instanceId: string, apiKey?: string): Promise<void> {
  const url = `${rootUrl(baseUrl)}/api/v1/models/unload`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
    body: JSON.stringify({ instance_id: instanceId }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`Unload failed (${r.status}): ${body.slice(0, 200)}`)
  }
}
