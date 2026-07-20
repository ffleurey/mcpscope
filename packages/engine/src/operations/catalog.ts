import type { z } from 'zod'
import type { OperationContext } from './context.js'
import { listOperation } from './list.js'
import { createOperation } from './create.js'
import { sendOperation } from './send.js'
import { statusOperation } from './status.js'
import { inspectOperation } from './inspect.js'
import { listModelConfigsOperation } from './listConfigs.js'
import { listMcpProfilesOperation } from './listConfigs.js'
import { deleteSessionOperation } from './delete.js'
import { renameSessionOperation } from './rename.js'
import { abortSessionOperation } from './abort.js'

/**
 * Structural contract satisfied by every catalog operation (engine and
 * workbench). The MCP server and CLI parity tests consume operations through
 * this shape; individual operations keep their precise input/result types.
 */
export interface BackendOperation {
  readonly id: string
  readonly description: string
  /** Zod object input schema; `.shape` feeds MCP tool registration. */
  readonly schema: { readonly shape: z.ZodRawShape }
  /** Zod output shape for MCP structured output. */
  readonly outputSchema: Record<string, z.ZodType>
  execute(ctx: OperationContext, input: never): Promise<unknown>
}

/**
 * Engine-owned operations (chat path). Workbench operations (the benchmark
 * family) are NOT part of this set — the workbench appends them at startup via
 * `registerOperationExtension` (see `registerBenchmarkOperations()` in
 * `benchmarkOperations.ts`, called from `buildBackendApp` before the MCP/CLI
 * surfaces consume the catalog).
 */
export const engineOperationList = [
  listOperation,
  createOperation,
  sendOperation,
  statusOperation,
  inspectOperation,
  listModelConfigsOperation,
  listMcpProfilesOperation,
  deleteSessionOperation,
  renameSessionOperation,
  abortSessionOperation,
] as const

const extensionOperations = new Map<string, readonly BackendOperation[]>()

/**
 * Register a named set of workbench operations, appended after the engine set
 * in registration order. Keyed so repeated startup wiring stays idempotent,
 * mirroring the other engine-side registries.
 */
export function registerOperationExtension(
  name: string,
  operations: readonly BackendOperation[],
): void {
  extensionOperations.set(name, operations)
}

/** Full operation list: engine operations plus registered extensions, in order. */
export function getOperationList(): BackendOperation[] {
  return [...engineOperationList, ...Array.from(extensionOperations.values()).flat()]
}

/** Full operation catalog keyed by operation id. */
export function getOperationCatalog(): Record<string, BackendOperation> {
  return Object.fromEntries(getOperationList().map((op) => [op.id, op]))
}
