import type { ConnectionTestResult } from '../types'

interface JsonRpcResponse {
  jsonrpc: string
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

interface McpPostResult {
  rpc: JsonRpcResponse
  sessionId: string | null
}

async function mcpPost(url: string, body: object, sessionId?: string): Promise<McpPostResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId

  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })

  if (!response.ok) {
    let text = ''
    try { text = await response.text() } catch {}
    throw new Error(`HTTP ${response.status} ${response.statusText}${text ? ': ' + text.slice(0, 300) : ''}`)
  }

  const returnedSessionId = response.headers.get('mcp-session-id')

  const contentType = response.headers.get('content-type') ?? ''
  let rpc: JsonRpcResponse
  if (contentType.includes('text/event-stream')) {
    const text = await response.text()
    const dataLine = text.split('\n').find(l => l.startsWith('data:'))
    if (!dataLine) throw new Error('SSE response contained no data line')
    rpc = JSON.parse(dataLine.slice(5).trim())
  } else {
    rpc = await response.json()
  }

  return { rpc, sessionId: returnedSessionId }
}

export async function testMcpConnection(serverUrl: string): Promise<ConnectionTestResult> {
  const url = serverUrl.replace(/\/$/, '')
  try {
    // Step 1: initialize — captures the session ID from the response headers
    const { rpc: initResp, sessionId } = await mcpPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ai-client-app', version: '0.1.0' },
      },
    })
    if (initResp.error) {
      return {
        status: 'error',
        message: `MCP error ${initResp.error.code}: ${initResp.error.message}`,
        details: [],
      }
    }
    const initResult = initResp.result as {
      serverInfo?: { name?: string; version?: string }
      protocolVersion?: string
    }
    const serverName = initResult?.serverInfo?.name ?? 'unknown'
    const serverVersion = initResult?.serverInfo?.version ?? ''

    // Step 2: tools/list — must include the session ID
    let toolNames: string[] = []
    try {
      const { rpc: toolsResp } = await mcpPost(url, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }, sessionId ?? undefined)
      if (!toolsResp.error) {
        const tools = (toolsResp.result as { tools?: Array<{ name?: string }> })?.tools ?? []
        toolNames = tools.map(t => t.name ?? '').filter(Boolean)
      }
    } catch {
      // tools/list is best-effort
    }

    const details: string[] = [
      `Server: ${serverName}${serverVersion ? ' v' + serverVersion : ''}`,
    ]
    details.push(toolNames.length > 0 ? `Tools: ${toolNames.join(', ')}` : 'No tools found')

    return { status: 'success', message: 'Connected', details }
  } catch (e) {
    const msg = e instanceof TypeError ? e.message : String(e)
    const isCors =
      msg.toLowerCase().includes('failed to fetch') ||
      msg.toLowerCase().includes('networkerror') ||
      msg.toLowerCase().includes('network request failed') ||
      msg.toLowerCase().includes('load failed')
    if (isCors) {
      return {
        status: 'error',
        message: 'Cannot reach MCP server — possible CORS or network issue.',
        details: [
          'Ensure the MCP server is running and allows cross-origin requests from this origin.',
          'The server must return Access-Control-Allow-Origin headers for browser access.',
        ],
      }
    }
    return {
      status: 'error',
      message: `Error: ${msg}`,
      details: [],
    }
  }
}
