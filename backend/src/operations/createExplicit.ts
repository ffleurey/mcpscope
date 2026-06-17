/**
 * createExplicit — backend-owned operation for POST /api/sessions.
 *
 * This operation creates a session from an explicitly supplied model profile
 * snapshot (rather than resolving from backend-owned defaults).
 *
 * It is a test/advanced explicit-snapshot fixture path with NO current
 * production caller: the frontend creates primary sessions via
 * POST /api/session-constructors/primary (launchPrimarySession), and the
 * CLI/MCP use the `create` operation. POST /api/sessions is exercised only by
 * backend tests that need to seed a session from a fully-resolved snapshot.
 *
 * This operation is NOT part of the CLI/MCP catalog. It does not appear in
 * operationList or operationCatalog. It is a thin backend-owned execution
 * function consumed only by the /api/sessions HTTP route.
 *
 * The result contract is the full camelCase SessionRecord shape.
 */
import { z } from 'zod'
import type { OperationError } from './errors.js'
import { createSession } from '../runtime/modelTurns.js'
import { mapSessionIdError } from './sessionCreationShared.js'
import {
  modelProfileSnapshotInputSchema,
  mcpProfileSnapshotInputSchema,
} from '../domain/apiSchemas.js'
import { sessionRecordSchema, type SessionRecord } from '../domain/model.js'
import type { OperationContext } from './context.js'

// ─── Input schema ─────────────────────────────────────────────────────────────

export const createExplicitInputSchema = z.object({
  sessionId: z.string().optional(),
  title: z.string().optional(),
  modelProfileSnapshot: modelProfileSnapshotInputSchema,
  mcpProfileSnapshots: z.array(mcpProfileSnapshotInputSchema).default([]),
  compactionStrategy: z.enum(['none', 'strip-reasoning']).optional(),
})

export type CreateExplicitInput = z.infer<typeof createExplicitInputSchema>

// ─── Result ───────────────────────────────────────────────────────────────────

/** Full session record returned to the frontend (camelCase — matches frontend sessionRecordSchema). */
export interface CreateExplicitResult {
  session: SessionRecord
}

export const createExplicitOutputSchema = {
  session: sessionRecordSchema,
}

export const createExplicitOperation = {
  schema: createExplicitInputSchema,
  outputSchema: createExplicitOutputSchema,
  async execute(ctx: OperationContext, rawInput: unknown): Promise<CreateExplicitResult> {
    return executeCreateExplicit(ctx, rawInput)
  },
}

// ─── Execution ────────────────────────────────────────────────────────────────

export async function executeCreateExplicit(
  ctx: OperationContext,
  rawInput: unknown,
): Promise<CreateExplicitResult> {
  const { db } = ctx

  const input = createExplicitInputSchema.parse(rawInput)

  type TxResult =
    | { kind: 'id_error'; error: OperationError }
    | { kind: 'created'; session: SessionRecord }

  const result: TxResult = db.connection.transaction((): TxResult => {
    try {
      const session = createSession(db, {
        sessionId: input.sessionId,
        title: input.title,
        modelProfileSnapshot: input.modelProfileSnapshot,
        mcpProfileSnapshots: input.mcpProfileSnapshots,
        compactionStrategy: input.compactionStrategy ?? 'strip-reasoning',
      })
      return { kind: 'created', session }
    } catch (error) {
      const mapped = mapSessionIdError(error)
      if (mapped) return { kind: 'id_error', error: mapped }
      throw error
    }
  })()

  if (result.kind === 'id_error') {
    throw result.error
  }

  return { session: result.session }
}
