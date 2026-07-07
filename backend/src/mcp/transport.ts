import type { FastifyInstance } from 'fastify'
import { createMcpServer } from './server.js'
import { createAnalysisMcpServer } from './analysisServer.js'
import type { OperationContext } from './server.js'
import { registerStreamableHttpMcp } from './streamableHttp.js'

/**
 * Register Streamable HTTP MCP routes on the Fastify instance.
 *
 * Routes:
 *   POST   /mcp  — JSON-RPC tool calls
 *   GET    /mcp  — SSE stream for server-initiated messages
 *   DELETE /mcp  — session termination (stateless: no-op)
 *
 * Each request gets a fresh transport in stateless mode (see registerStreamableHttpMcp).
 * Operations execute directly against the backend (no loopback HTTP).
 */
export function registerMcpTransport(app: FastifyInstance, ctx: OperationContext): void {
  registerStreamableHttpMcp(app, '/mcp', () => createMcpServer(ctx))

  // ─── Restricted analysis MCP endpoint ────────────────────────────────────────
  // Only exposes inspect + status so analysis agents can read trace data but
  // cannot create sessions, list all sessions, or send arbitrary prompts.
  registerStreamableHttpMcp(app, '/mcp/analysis', () => createAnalysisMcpServer(ctx))
}

export type { OperationContext }
