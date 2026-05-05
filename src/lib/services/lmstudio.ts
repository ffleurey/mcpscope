import type { ConnectionTestResult } from '../types'

// LM Studio 0.4+ native model shape from /api/v1/models
interface LmStudioNativeModel {
  type: string
  key: string
  display_name?: string
  max_context_length?: number
  loaded_instances?: unknown[]
}

// Derive the LM Studio root URL from the configured OpenAI-compatible base URL.
// e.g. "http://localhost:1234/v1" → "http://localhost:1234"
// Also handles bare roots like "http://localhost:1234"
function rootUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/$/, '')
  return clean.endsWith('/v1') ? clean.slice(0, -3) : clean
}

export async function testLmStudioConnection(baseUrl: string): Promise<ConnectionTestResult> {
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
      const r = await fetch(nativeUrl, { headers: { Accept: 'application/json' } })
      if (r.ok) {
        data = await r.json()
        usedNative = true
      }
    } catch {
      // native endpoint failed; will try compat below
    }

    if (!usedNative) {
      const r = await fetch(compatUrl, { headers: { Accept: 'application/json' } })
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
