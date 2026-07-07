import type { FastifyInstance } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

/**
 * Minimal shape shared by every MCP server factory we mount (`McpServer` from the
 * SDK satisfies it). Kept structural so callers don't need the concrete type.
 */
export type McpServerLike = {
  connect: (transport: Transport) => Promise<void>
  close: () => Promise<void>
}

type RouteHandler = Parameters<FastifyInstance['route']>[0]['handler']
type RouteRequest = Parameters<RouteHandler>[0]
type RouteReply = Parameters<RouteHandler>[1]

/**
 * Mount one stateless Streamable HTTP MCP server on `POST|GET|DELETE <routePath>`.
 *
 * Stateless mode (no `sessionIdGenerator`): each request gets a fresh transport +
 * server that are torn down when the response closes, otherwise per-request server
 * objects and their listeners accumulate on a long-running daemon (and SSE GETs
 * leak). `createServer` is called once per request.
 *
 * This is the single shared mount path for mcpscope's own `/mcp` + `/mcp/analysis`
 * endpoints and for the bundled companion servers.
 */
export function registerStreamableHttpMcp(
  app: FastifyInstance,
  routePath: string,
  createServer: () => McpServerLike,
): void {
  const handler = async (request: RouteRequest, reply: RouteReply): Promise<void> => {
    reply.hijack()

    const transport = new StreamableHTTPServerTransport({})
    const server = createServer()

    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })

    // Cast needed due to exactOptionalPropertyTypes mismatch in SDK type definitions.
    await server.connect(transport as unknown as Transport)

    const parsedBody = request.method === 'POST' ? (request.body as unknown) : undefined
    await transport.handleRequest(request.raw, reply.raw, parsedBody)
  }

  app.post(routePath, handler)
  app.get(routePath, handler)
  app.delete(routePath, handler)
}
