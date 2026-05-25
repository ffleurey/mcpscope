import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'

/**
 * Runtime context passed to every backend operation execute function.
 * Gives operations direct access to the database and runtime dependencies
 * without going through the HTTP API.
 */
export interface OperationContext {
  db: BackendDatabase
  lmStudioGateway: LmStudioGateway
  mcpGateway: McpGateway
  maxToolRounds: number
  /** Optional logger for background error reporting. */
  logger?: { error: (data: Record<string, unknown>, msg: string) => void }
}
