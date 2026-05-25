import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { OperationError, operationList } from '@mcpscope/shared'

// MCP tool name prefix applied automatically to all canonical operation IDs.
const TOOL_PREFIX = 'mcpscope_'

/**
 * Create and configure an McpServer from the shared operation catalog.
 * Each operation becomes one MCP tool with the name `mcpscope_<id>`.
 * Descriptions and schemas come from the shared catalog — same source as CLI help.
 */
export function createMcpServer(baseUrl: string): McpServer {
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
        inputSchema: op.schema,
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await op.execute(baseUrl, args as never)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          }
        } catch (err) {
          const message = err instanceof OperationError || err instanceof Error
            ? err.message
            : String(err)
          const code = err instanceof OperationError ? err.code : undefined
          const errorPayload: Record<string, unknown> = { error: { message } }
          if (code !== undefined) errorPayload['error'] = { message, code }
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
