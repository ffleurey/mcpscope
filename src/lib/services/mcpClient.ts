/**
 * MCP client service — wraps @modelcontextprotocol/sdk for use in the browser.
 *
 * Uses the official SDK (Client + StreamableHTTPClientTransport) for protocol
 * correctness, with a logging fetch interceptor for full observability.
 *
 * One McpClientHandle per ChatSession — created at first message, closed on delete.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpToolDefinition } from '../types'

// ---- Types ----

export interface McpSessionInfo {
  sessionId: string
  serverName: string
  serverVersion: string
  protocolVersion: string
  tools: McpToolDefinition[]
  instructions?: string
  rawInitializeResult?: unknown  // for ⋯ raw dialog
}

export interface McpToolCallResult {
  content: string          // joined text content
  isError: boolean
  rawResult: unknown       // full MCP result object for ⋯ raw dialog
  durationMs: number
}

// Captured request/response for observability
export interface McpRawExchange {
  requestUrl: string
  requestMethod: string
  requestBody: string
  responseStatus: number
  responseBody: string
  timestamp: number
}

// ---- Logging fetch interceptor ----

type OnExchange = (exchange: McpRawExchange) => void

function makeLoggingFetch(onExchange?: OnExchange): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    const response = await fetch(input, init)
    if (onExchange) {
      // Clone to read body without consuming the original
      const clone = response.clone()
      clone.text().then(body => {
        onExchange({
          requestUrl: url,
          requestMethod: init?.method ?? 'GET',
          requestBody: bodyText,
          responseStatus: response.status,
          responseBody: body,
          timestamp: Date.now(),
        })
      }).catch(() => {/* ignore */})
    }
    return response
  }
}

// ---- McpClientHandle ----

export class McpClientHandle {
  private client: Client
  private sessionInfo: McpSessionInfo | null = null
  private closed = false
  public readonly exchanges: McpRawExchange[] = []

  constructor(
    private readonly mcpUrl: string,
    private readonly onExchange?: OnExchange
  ) {
    this.client = new Client(
      { name: 'ai-clientapp', version: '0.1.0' },
      { capabilities: {} }
    )
  }

  async initialize(): Promise<McpSessionInfo> {
    if (this.sessionInfo) return this.sessionInfo
    if (this.closed) throw new Error('MCP client is closed')

    const loggingFetch = makeLoggingFetch(exchange => {
      this.exchanges.push(exchange)
      this.onExchange?.(exchange)
    })

    const transport = new StreamableHTTPClientTransport(
      new URL(this.mcpUrl),
      { fetch: loggingFetch as Parameters<typeof StreamableHTTPClientTransport>[1]['fetch'] }
    )

    await this.client.connect(transport)

    // Fetch tools list
    const toolsResult = await this.client.listTools()
    const tools: McpToolDefinition[] = (toolsResult.tools ?? []).map(t => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }))

    // Extract session info from the server info (available after connect)
    const serverInfo = this.client.getServerVersion()

    this.sessionInfo = {
      sessionId: crypto.randomUUID(),  // SDK manages real session internally
      serverName: serverInfo?.name ?? 'unknown',
      serverVersion: serverInfo?.version ?? 'unknown',
      protocolVersion: serverInfo?.protocolVersion ?? '2025-06-18',
      tools,
      instructions: (this.client.getServerCapabilities() as Record<string, unknown> & { instructions?: string })?.instructions as string | undefined,
    }

    return this.sessionInfo
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (this.closed) throw new Error('MCP client is closed')
    if (!this.sessionInfo) await this.initialize()

    const startedAt = Date.now()
    const result = await this.client.callTool({ name, arguments: args })
    const durationMs = Date.now() - startedAt

    // Extract text content from result
    const content = (result.content ?? [])
      .map((item: unknown) => {
        const c = item as { type?: string; text?: string }
        if (c.type === 'text') return c.text ?? ''
        return `[${c.type ?? 'unknown'} content]`
      })
      .join('\n')

    return {
      content,
      isError: (result as { isError?: boolean }).isError === true,
      rawResult: result,
      durationMs,
    }
  }

  getSessionInfo(): McpSessionInfo | null {
    return this.sessionInfo
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      await this.client.close()
    } catch {
      // Ignore close errors
    }
  }
}

// ---- Connection test (used by MCP profile form) ----

export interface McpConnectionTestResult {
  status: 'success' | 'error'
  message: string
  details: string[]
  serverName?: string
  serverVersion?: string
  toolCount?: number
  instructions?: string
}

export async function testMcpConnection(url: string): Promise<McpConnectionTestResult> {
  const handle = new McpClientHandle(url)
  try {
    const info = await handle.initialize()
    return {
      status: 'success',
      message: `Connected to ${info.serverName} ${info.serverVersion}`,
      details: [
        `Protocol: ${info.protocolVersion}`,
        `Tools: ${info.tools.length} available`,
        ...info.tools.map(t => `  • ${t.name}`),
        ...(info.instructions ? [`Instructions: ${info.instructions.slice(0, 100)}…`] : []),
      ],
      serverName: info.serverName,
      serverVersion: info.serverVersion,
      toolCount: info.tools.length,
      instructions: info.instructions,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      status: 'error',
      message: 'Connection failed',
      details: [msg],
    }
  } finally {
    await handle.close()
  }
}
