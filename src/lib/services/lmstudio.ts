import type { ConnectionTestResult } from '../types'

// LM Studio 0.4+ native model shape from /api/v1/models
interface LmStudioNativeModel {
  type: string
  key: string
  display_name?: string
  max_context_length?: number
  loaded_instances?: unknown[]
}

export interface LmStudioModel {
  uid: string           // unique per entry: key + ':' + displayName (for {#each})
  key: string           // model key sent to the API (may repeat across cluster nodes)
  displayName: string
  contextLength: number | null
  isLoaded: boolean
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
          return {
            uid: `${m.key}:${displayName}`,
            key: m.key,
            displayName,
            contextLength: m.max_context_length ?? null,
            isLoaded: Array.isArray(m.loaded_instances) && m.loaded_instances.length > 0,
          }
        })
    } else {
      const items: { id?: string }[] = Array.isArray((data as { data?: { id?: string }[] })?.data)
        ? (data as { data: { id?: string }[] }).data
        : []
      return items
        .map(m => m.id ?? '')
        .filter(Boolean)
        .map(id => ({ uid: id, key: id, displayName: id, contextLength: null, isLoaded: false }))
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
          const ctx = m.max_context_length ? ` (${(m.max_context_length / 1000).toFixed(0)}k ctx)` : ''
          const active = loaded.some(l => l.key === m.key) ? ' [loaded]' : ''
          return `${m.key}${ctx}${active}`
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

export interface StreamChunk {
  content: string
  thinking: string   // from delta.reasoning_content — empty string if none
  done: boolean
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export async function* streamChatCompletion(
  baseUrl: string,
  modelId: string,
  messages: { role: string; content: string }[],
  temperature: number,
  apiKey?: string,
  abortSignal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const url = `${rootUrl(baseUrl)}/v1/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
    body: JSON.stringify({ model: modelId, messages, temperature, stream: true }),
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

  try {
    while (true) {
      if (abortSignal?.aborted) return

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      // Keep last (potentially incomplete) line in buffer
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()

        if (data === '[DONE]') {
          yield { content: '', thinking: '', done: true }
          return
        }

        try {
          const parsed = JSON.parse(data)
          const delta = parsed?.choices?.[0]?.delta
          const thinking = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : ''
          const content = typeof delta?.content === 'string' ? delta.content : ''
          if (thinking.length > 0 || content.length > 0) {
            yield { content, thinking, done: false }
          }
          // Capture usage if present in this chunk
          if (parsed?.usage) {
            const u = parsed.usage
            yield {
              content: '',
              thinking: '',
              done: true,
              usage: {
                promptTokens: u.prompt_tokens ?? 0,
                completionTokens: u.completion_tokens ?? 0,
                totalTokens: u.total_tokens ?? 0,
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
