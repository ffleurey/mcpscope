interface JsonRpcResponse {
  jsonrpc: string
  id: number
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

/** Auth to apply to MCP HTTP requests, taken from an MCP server profile. */
export interface McpAuth {
  type: 'none' | 'bearer' | 'basic' | null
  value: string | null
}

/**
 * Build the Authorization header for an MCP request. `bearer` sends the value
 * verbatim as a Bearer token; `basic` treats the value as `username:password`
 * and base64-encodes it per RFC 7617. Returns `{}` when auth is absent.
 */
export function mcpAuthHeaders(auth?: McpAuth | null): Record<string, string> {
  if (!auth || !auth.type || auth.type === 'none' || !auth.value) return {}
  if (auth.type === 'bearer') return { Authorization: `Bearer ${auth.value}` }
  if (auth.type === 'basic') {
    const encoded = Buffer.from(auth.value, 'utf-8').toString('base64')
    return { Authorization: `Basic ${encoded}` }
  }
  return {}
}

interface McpPostResult {
  rpc: JsonRpcResponse
  sessionId: string | null
  responseBody: unknown
  responseBodyText: string
  requestBodyText: string
  responseStatus: number
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string> | null
}

export interface McpInitializeResult {
  sessionId: string | null
  serverInfo: {
    name: string
    version: string
  }
  protocolVersion: string | null
  rawResult: unknown
  instructions?: string | undefined
  rawExchange: McpRawExchange
}

export interface McpToolsListResult {
  tools: Array<{
    name: string
    description?: string | undefined
    inputSchema?: unknown
  }>
  rawResult: unknown
  rawExchange: McpRawExchange
}

export interface McpToolCallResult {
  content: string
  structuredContent: unknown
  isError: boolean
  rawResult: unknown
  rawExchange: McpRawExchange
}

export interface McpRawExchange {
  requestUrl: string
  requestMethod: string
  requestHeaders?: Record<string, string> | null
  requestBodyText: string
  responseStatus: number
  responseHeaders?: Record<string, string> | null
  responseBodyText?: string | null
  responseBody: unknown
}

async function mcpPost(
  url: string,
  body: object,
  sessionId?: string,
  auth?: McpAuth | null,
): Promise<McpPostResult> {
  const requestBodyText = JSON.stringify(body)
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...mcpAuthHeaders(auth),
  }
  if (sessionId) requestHeaders['mcp-session-id'] = sessionId

  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body: requestBodyText,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`MCP request failed: ${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
  }

  const returnedSessionId = response.headers.get('mcp-session-id')
  const contentType = response.headers.get('content-type') ?? ''
  const responseHeaders = {
    ...(contentType ? { 'content-type': contentType } : {}),
    ...(returnedSessionId ? { 'mcp-session-id': returnedSessionId } : {}),
  }

  let responseBody: unknown
  let responseBodyText: string
  if (contentType.includes('text/event-stream')) {
    responseBodyText = await response.text()
    if (!responseBodyText.trim()) {
      responseBody = { jsonrpc: '2.0', id: -1, result: null } satisfies JsonRpcResponse
      return {
        rpc: responseBody as JsonRpcResponse,
        sessionId: returnedSessionId,
        responseBody,
        responseBodyText,
        requestBodyText,
        responseStatus: response.status,
        requestHeaders,
        responseHeaders: Object.keys(responseHeaders).length > 0 ? responseHeaders : null,
      }
    }

    const dataLine = responseBodyText
      .split('\n')
      .find(line => line.startsWith('data:'))

    if (!dataLine) {
      throw new Error('MCP SSE response did not contain a data line')
    }

    responseBody = JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse
  } else {
    responseBodyText = await response.text()
    responseBody = responseBodyText.trim()
      ? (JSON.parse(responseBodyText) as JsonRpcResponse)
      : ({ jsonrpc: '2.0', id: -1, result: null } satisfies JsonRpcResponse)
  }

  return {
    rpc: responseBody as JsonRpcResponse,
    sessionId: returnedSessionId,
    responseBody,
    responseBodyText,
    requestBodyText,
    responseStatus: response.status,
    requestHeaders,
    responseHeaders: Object.keys(responseHeaders).length > 0 ? responseHeaders : null,
  }
}

export async function initializeMcpSession(serverUrl: string, auth?: McpAuth | null): Promise<McpInitializeResult> {
  const normalizedUrl = serverUrl.replace(/\/$/, '')

  const { rpc, sessionId, responseBody, responseBodyText, requestBodyText, responseStatus, requestHeaders, responseHeaders } = await mcpPost(normalizedUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'mcpscope',
        version: '0.1.0',
      },
    },
  }, undefined, auth)

  if (rpc.error) {
    throw new Error(`MCP initialize error ${rpc.error.code}: ${rpc.error.message}`)
  }

  const result = (rpc.result ?? {}) as {
    serverInfo?: {
      name?: string
      version?: string
    }
    protocolVersion?: string
  }

  await mcpPost(
    normalizedUrl,
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    },
    sessionId ?? undefined,
    auth,
  )

  return {
    sessionId,
    serverInfo: {
      name: result.serverInfo?.name ?? 'unknown',
      version: result.serverInfo?.version ?? 'unknown',
    },
    protocolVersion: result.protocolVersion ?? null,
    rawResult: responseBody,
    instructions: (result as { instructions?: string }).instructions,
    rawExchange: {
      requestUrl: normalizedUrl,
      requestMethod: 'POST',
      requestHeaders,
      requestBodyText,
      responseStatus,
      responseHeaders,
      responseBodyText,
      responseBody,
    },
  }
}

export async function listMcpTools(serverUrl: string, sessionId: string | null, auth?: McpAuth | null): Promise<McpToolsListResult> {
  const normalizedUrl = serverUrl.replace(/\/$/, '')

  const { rpc, responseBody, responseBodyText, requestBodyText, responseStatus, requestHeaders, responseHeaders } = await mcpPost(
    normalizedUrl,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    },
    sessionId ?? undefined,
    auth,
  )

  if (rpc.error) {
    throw new Error(`MCP tools/list error ${rpc.error.code}: ${rpc.error.message}`)
  }

  const result = (rpc.result ?? {}) as {
    tools?: Array<{
      name?: string
      description?: string
      inputSchema?: unknown
    }>
  }

  return {
    tools: (result.tools ?? []).map(tool => ({
      name: tool.name ?? 'unknown',
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    rawResult: responseBody,
    rawExchange: {
      requestUrl: normalizedUrl,
      requestMethod: 'POST',
      requestHeaders,
      requestBodyText,
      responseStatus,
      responseHeaders,
      responseBodyText,
      responseBody,
    },
  }
}

export async function callMcpTool(
  serverUrl: string,
  sessionId: string | null,
  name: string,
  args: Record<string, unknown>,
  auth?: McpAuth | null,
): Promise<McpToolCallResult> {
  const normalizedUrl = serverUrl.replace(/\/$/, '')

  const { rpc, responseBody, responseBodyText, requestBodyText, responseStatus, requestHeaders, responseHeaders } = await mcpPost(
    normalizedUrl,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    },
    sessionId ?? undefined,
    auth,
  )

  if (rpc.error) {
    throw new Error(`MCP tools/call error ${rpc.error.code}: ${rpc.error.message}`)
  }

  const result = (rpc.result ?? {}) as {
    content?: Array<{ type?: string; text?: string }>
    structuredContent?: unknown
    isError?: boolean
  }

  return {
    content: (result.content ?? [])
      .map(item => (item.type === 'text' ? (item.text ?? '') : `[${item.type ?? 'unknown'} content]`))
      .join('\n'),
    structuredContent: result.structuredContent ?? null,
    isError: result.isError === true,
    rawResult: responseBody,
    rawExchange: {
      requestUrl: normalizedUrl,
      requestMethod: 'POST',
      requestHeaders,
      requestBodyText,
      responseStatus,
      responseHeaders,
      responseBodyText,
      responseBody,
    },
  }
}
