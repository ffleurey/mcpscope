import { inspectOperation, statusOperation } from '../operations/index.js'
import type { OperationContext } from '../operations/index.js'
import { buildMcpServer } from './server.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** Operations exposed to analysis agents: read-only inspection only. */
const ANALYSIS_OPS = [inspectOperation, statusOperation] as const

/**
 * Create a restricted McpServer for analysis sessions.
 *
 * Exposes only inspect + status so the analysis agent can read trace data
 * but cannot create sessions, list all sessions, or send arbitrary prompts.
 */
export function createAnalysisMcpServer(ctx: OperationContext, version = 'dev'): McpServer {
  return buildMcpServer(ctx, ANALYSIS_OPS, 'mcpscope-analysis', version)
}
