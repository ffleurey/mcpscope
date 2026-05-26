import type { FastifyInstance } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createMcpServer } from './server.js'
import { createAnalysisMcpServer } from './analysisServer.js'
import type { OperationContext } from './server.js'

/**
 * Register Streamable HTTP MCP routes on the Fastify instance.
 *
 * Routes:
 *   POST   /mcp  — JSON-RPC tool calls
 *   GET    /mcp  — SSE stream for server-initiated messages
 *   DELETE /mcp  — session termination (stateless: no-op)
 *
 * Each request gets a fresh transport in stateless mode.
 * Operations execute directly against the backend (no loopback HTTP).
 */
export function registerMcpTransport(app: FastifyInstance, ctx: OperationContext): void {
  const handleMcpRequest = async (
    request: Parameters<Parameters<FastifyInstance['route']>[0]['handler']>[0],
    reply: Parameters<Parameters<FastifyInstance['route']>[0]['handler']>[1],
  ): Promise<void> => {
    reply.hijack()

    // Omitting sessionIdGenerator opts into stateless mode (no session tracking).
    const transport = new StreamableHTTPServerTransport({})

    const server = createMcpServer(ctx)
    // Cast needed due to exactOptionalPropertyTypes mismatch in SDK type definitions.
    await server.connect(transport as unknown as Transport)

    const parsedBody = request.method === 'POST' ? (request.body as unknown) : undefined
    await transport.handleRequest(request.raw, reply.raw, parsedBody)
  }

  app.post('/mcp', handleMcpRequest)
  app.get('/mcp', handleMcpRequest)
  app.delete('/mcp', handleMcpRequest)

  // ─── Restricted analysis MCP endpoint ────────────────────────────────────────
  // Only exposes inspect + status so analysis agents can read trace data but
  // cannot create sessions, list all sessions, or send arbitrary prompts.
  const handleAnalysisMcpRequest = async (
    request: Parameters<Parameters<FastifyInstance['route']>[0]['handler']>[0],
    reply: Parameters<Parameters<FastifyInstance['route']>[0]['handler']>[1],
  ): Promise<void> => {
    reply.hijack()

    const transport = new StreamableHTTPServerTransport({})
    const server = createAnalysisMcpServer(ctx)
    await server.connect(transport as unknown as Transport)

    const parsedBody = request.method === 'POST' ? (request.body as unknown) : undefined
    await transport.handleRequest(request.raw, reply.raw, parsedBody)
  }

  app.post('/mcp/analysis', handleAnalysisMcpRequest)
  app.get('/mcp/analysis', handleAnalysisMcpRequest)
  app.delete('/mcp/analysis', handleAnalysisMcpRequest)
}

export type { OperationContext }


