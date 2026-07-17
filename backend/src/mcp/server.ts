import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { OperationError } from '../operations/errors.js'
import { getOperationList } from '../operations/index.js'
import type { BackendOperation } from '../operations/index.js'
import type { OperationContext } from '../operations/index.js'

type Operation = BackendOperation

// MCP tool name prefix applied automatically to all canonical operation IDs.
const TOOL_PREFIX = 'mcpscope_'

/**
 * Shared factory: build an McpServer that exposes exactly the given operations.
 *
 * Each operation becomes one MCP tool named `mcpscope_<id>`.
 * Descriptions, input schemas, output schemas, and execute functions all come
 * from the backend-owned catalog — same source as CLI help text and CLI JSON output.
 *
 * Operations execute directly against the backend (no loopback HTTP).
 * Results are returned as both `content` (text fallback) and `structuredContent`
 * (structured output for clients that support outputSchema).
 */
export function buildMcpServer(
  ctx: OperationContext,
  ops: readonly Operation[],
  serverName = 'mcpscope',
): McpServer {
  const server = new McpServer(
    { name: serverName, version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  for (const op of ops) {
    const toolName = `${TOOL_PREFIX}${op.id}`
    // Operations may own their transport rendering (e.g. inspect renders text by
    // default). Such ops return a single text channel and declare no outputSchema,
    // so the payload is never double-encoded as both content + structuredContent.
    const renderContent = (op as {
      renderContent?: (result: unknown, args: Record<string, unknown>) => { text: string }
    }).renderContent
    server.registerTool(
      toolName,
      {
        description: op.description,
        inputSchema: op.schema.shape,
        ...(renderContent ? {} : { outputSchema: op.outputSchema }),
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await op.execute(ctx, args as never)
          if (renderContent) {
            return {
              content: [{ type: 'text' as const, text: renderContent(result, args).text }],
            }
          }
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
          // Raw Error.message is deliberately surfaced: mcpscope is a
          // local-first tool, so the MCP caller is the operator debugging
          // their own instance — hiding the message would only hurt.
          const message = err instanceof OperationError || err instanceof Error
            ? err.message
            : String(err)
          const code = err instanceof OperationError ? err.code : undefined
          // Keep active_session (which session blocks another_session_active)
          // — the HTTP path preserves it and agents need it just as much.
          const activeSession = err instanceof OperationError ? err.active_session : undefined
          const errorPayload: Record<string, unknown> = {
            error: {
              message,
              ...(code !== undefined ? { code } : {}),
              ...(activeSession !== undefined ? { active_session: activeSession } : {}),
            },
          }
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

/**
 * Create an McpServer exposing the full operation catalog — the engine
 * operations plus any workbench extensions registered by startup wiring
 * (buildBackendApp registers the benchmark set before serving requests).
 */
export function createMcpServer(ctx: OperationContext): McpServer {
  return buildMcpServer(ctx, getOperationList())
}

export { TOOL_PREFIX }
export type { OperationContext }

