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
type RouteHandler = Parameters<FastifyInstance['route']>[0]['handler']
type RouteRequest = Parameters<RouteHandler>[0]
type RouteReply = Parameters<RouteHandler>[1]

// Server factory type: createMcpServer / createAnalysisMcpServer share this shape.
type McpServerLike = { connect: (transport: Transport) => Promise<void>; close: () => Promise<void> }

export function registerMcpTransport(app: FastifyInstance, ctx: OperationContext): void {
  // Stateless mode: each request gets a fresh transport + server that must be
  // torn down when the response closes, otherwise per-request server objects and
  // their listeners accumulate on a long-running daemon (and SSE GETs leak).
  const makeHandler =
    (createServer: (ctx: OperationContext) => McpServerLike) =>
    async (request: RouteRequest, reply: RouteReply): Promise<void> => {
      reply.hijack()

      // Omitting sessionIdGenerator opts into stateless mode (no session tracking).
      const transport = new StreamableHTTPServerTransport({})
      const server = createServer(ctx)

      reply.raw.on('close', () => {
        void transport.close()
        void server.close()
      })

      // Cast needed due to exactOptionalPropertyTypes mismatch in SDK type definitions.
      await server.connect(transport as unknown as Transport)

      const parsedBody = request.method === 'POST' ? (request.body as unknown) : undefined
      await transport.handleRequest(request.raw, reply.raw, parsedBody)
    }

  const handleMcpRequest = makeHandler(createMcpServer)
  app.post('/mcp', handleMcpRequest)
  app.get('/mcp', handleMcpRequest)
  app.delete('/mcp', handleMcpRequest)

  // ─── Restricted analysis MCP endpoint ────────────────────────────────────────
  // Only exposes inspect + status so analysis agents can read trace data but
  // cannot create sessions, list all sessions, or send arbitrary prompts.
  const handleAnalysisMcpRequest = makeHandler(createAnalysisMcpServer)
  app.post('/mcp/analysis', handleAnalysisMcpRequest)
  app.get('/mcp/analysis', handleAnalysisMcpRequest)
  app.delete('/mcp/analysis', handleAnalysisMcpRequest)
}

export type { OperationContext }


