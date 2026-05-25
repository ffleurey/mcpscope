import type { FastifyInstance } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createMcpServer } from './server.js'

/**
 * Register Streamable HTTP MCP routes on the Fastify instance.
 *
 * Routes:
 *   POST   /mcp  — JSON-RPC tool calls
 *   GET    /mcp  — SSE stream for server-initiated messages
 *   DELETE /mcp  — session termination (stateless: no-op)
 *
 * Each request gets a fresh transport in stateless mode.
 * The shared operation catalog is evaluated per-request using baseUrl.
 */
export function registerMcpTransport(app: FastifyInstance, baseUrl: string): void {
  const handleMcpRequest = async (
    request: Parameters<Parameters<FastifyInstance['route']>[0]['handler']>[0],
    reply: Parameters<Parameters<FastifyInstance['route']>[0]['handler']>[1],
  ): Promise<void> => {
    reply.hijack()

    // Omitting sessionIdGenerator opts into stateless mode (no session tracking).
    const transport = new StreamableHTTPServerTransport({})

    const server = createMcpServer(baseUrl)
    // Cast needed due to exactOptionalPropertyTypes mismatch in SDK type definitions.
    await server.connect(transport as unknown as Transport)

    const parsedBody = request.method === 'POST' ? (request.body as unknown) : undefined
    await transport.handleRequest(request.raw, reply.raw, parsedBody)
  }

  app.post('/mcp', handleMcpRequest)
  app.get('/mcp', handleMcpRequest)
  app.delete('/mcp', handleMcpRequest)
}
