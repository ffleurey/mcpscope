import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { OperationError } from '../operations/errors.js'
import { operationList } from '../operations/index.js'
import type { OperationContext } from '../operations/index.js'

// MCP tool name prefix applied automatically to all canonical operation IDs.
const TOOL_PREFIX = 'mcpscope_'

/**
 * Create and configure an McpServer from the backend-owned operation catalog.
 *
 * Each operation becomes one MCP tool named `mcpscope_<id>`.
 * Descriptions, input schemas, output schemas, and execute functions all come
 * from the backend-owned catalog — same source as CLI help text and CLI JSON output.
 *
 * Operations execute directly against the backend (no loopback HTTP).
 * Results are returned as both `content` (text fallback) and `structuredContent`
 * (structured output for clients that support outputSchema).
 */
export function createMcpServer(ctx: OperationContext): McpServer {
  const server = new McpServer(
    { name: 'mcpscope', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  for (const op of operationList) {
    const toolName = `${TOOL_PREFIX}${op.id}`
    server.registerTool(
      toolName,
      {
        description: op.description,
        inputSchema: op.schema.shape,
        outputSchema: op.outputSchema,
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await op.execute(ctx, args as never)
          const structuredContent = result as unknown as Record<string, unknown>
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            structuredContent,
          }
        } catch (err) {
          const message = err instanceof OperationError || err instanceof Error
            ? err.message
            : String(err)
          const code = err instanceof OperationError ? err.code : undefined
          const errorPayload: Record<string, unknown> = code !== undefined
            ? { error: { message, code } }
            : { error: { message } }
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(errorPayload, null, 2),
              },
            ],
            isError: true,
          }
        }
      },
    )
  }

  return server
}

export { TOOL_PREFIX }
export type { OperationContext }

