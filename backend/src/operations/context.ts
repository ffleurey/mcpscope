import type { BackendDatabase } from '../persistence/db.js'
import type { ConfigStore } from '../config/configStore.js'
import type { ChatCompletionGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import type { ExecutionScheduler } from '../runtime/scheduler.js'

/**
 * Workbench-owned context extensions, declaration-merged from the modules that
 * own them (e.g. `runtime/runControl.ts` adds `runControl`). Keeps the engine's
 * context free of benchmark/analysis imports while extension consumers stay
 * fully typed.
 */
export interface OperationContextExtensions {}

/**
 * Runtime context passed to every backend operation execute function.
 * Gives operations direct access to the database and runtime dependencies
 * without going through the HTTP API.
 */
export interface OperationContext {
  db: BackendDatabase
  /** App-owned editable configuration (LM connections, model configs, MCP profiles). */
  configStore: ConfigStore
  chatCompletionGateway: ChatCompletionGateway
  mcpGateway: McpGateway
  maxToolRounds: number
  /** URL of mcpscope's own restricted analysis MCP endpoint (e.g. http://127.0.0.1:3066/mcp/analysis). */
  analysisMcpUrl?: string
  /** Optional logger for background error reporting. */
  logger?: { error: (data: Record<string, unknown>, msg: string) => void }
  /** Backend-owned execution scheduler. Present when the app is initialized normally. */
  scheduler?: ExecutionScheduler
  /** Workbench-registered extensions (see OperationContextExtensions). */
  extensions?: OperationContextExtensions
}
