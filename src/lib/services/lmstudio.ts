import type { ConnectionTestResult } from '../types'

export async function testLmStudioConnection(baseUrl: string): Promise<ConnectionTestResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      let body = ''
      try { body = await response.text() } catch {}
      return {
        status: 'error',
        message: `Server returned ${response.status} ${response.statusText}`,
        details: body ? [body.slice(0, 300)] : [],
      }
    }
    const data = await response.json()
    const modelIds: string[] = Array.isArray(data?.data)
      ? data.data.map((m: { id?: string }) => m.id ?? '(unknown)').filter(Boolean)
      : []
    return {
      status: 'success',
      message: 'Connected',
      details: modelIds.length > 0 ? [`Models: ${modelIds.join(', ')}`] : ['No models found'],
    }
  } catch (e) {
    const msg = e instanceof TypeError ? e.message : String(e)
    const isCors =
      msg.toLowerCase().includes('failed to fetch') ||
      msg.toLowerCase().includes('networkerror') ||
      msg.toLowerCase().includes('network request failed')
    return {
      status: 'error',
      message: isCors
        ? 'Network error — possible CORS issue. Ensure LM Studio allows requests from this origin.'
        : `Network error: ${msg}`,
      details: [],
    }
  }
}
