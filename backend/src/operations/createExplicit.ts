/**
 * createExplicit — backend-owned operation for POST /api/sessions.
 *
 * This operation creates a session from an explicitly supplied model profile
 * snapshot (rather than resolving from backend-owned defaults). It is used by
 * the frontend, which always passes its own fully-resolved configuration.
 *
 * This operation is NOT part of the CLI/MCP catalog. It does not appear in
 * operationList or operationCatalog. It is a thin backend-owned execution
 * function consumed only by the /api/sessions HTTP route.
 *
 * The result contract is the full camelCase SessionRecord shape that the
 * frontend has always expected. Changing it to snake_case would require a
 * coordinated frontend update and is out of scope here.
 */
import { z } from 'zod'
import { OperationError } from './errors.js'
import { createSession, SessionIdConflictError, SessionIdGenerationError, SessionIdInputError } from '../runtime/modelTurns.js'
import { findActiveSession } from '../persistence/repository.js'
import {
  modelProfileSnapshotInputSchema,
  mcpProfileSnapshotInputSchema,
} from '../domain/apiSchemas.js'
import type { SessionRecord } from '../domain/model.js'
import type { OperationContext } from './context.js'

// ─── Input schema ─────────────────────────────────────────────────────────────

export const createExplicitInputSchema = z.object({
  sessionId: z.string().optional(),
  title: z.string().optional(),
  modelProfileSnapshot: modelProfileSnapshotInputSchema,
  mcpProfileSnapshot: mcpProfileSnapshotInputSchema.nullable().optional(),
  compactionStrategy: z.enum(['none', 'strip-reasoning']).optional(),
})

export type CreateExplicitInput = z.infer<typeof createExplicitInputSchema>

// ─── Result ───────────────────────────────────────────────────────────────────

/** Full session record returned to the frontend (camelCase — matches frontend sessionRecordSchema). */
export interface CreateExplicitResult {
  session: SessionRecord
}

// ─── Execution ────────────────────────────────────────────────────────────────

export async function executeCreateExplicit(
  ctx: OperationContext,
  rawInput: unknown,
): Promise<CreateExplicitResult> {
  const { db } = ctx

  const input = createExplicitInputSchema.parse(rawInput)

  type TxResult =
    | { kind: 'blocked'; active: { id: string; state: string } }
    | { kind: 'id_input_error'; error: SessionIdInputError }
    | { kind: 'id_conflict_error'; error: SessionIdConflictError }
    | { kind: 'id_generation_error'; error: SessionIdGenerationError }
    | { kind: 'created'; session: SessionRecord }

  const result: TxResult = db.connection.transaction((): TxResult => {
    const active = findActiveSession(db.connection)
    if (active) return { kind: 'blocked', active: { id: active.id, state: active.state } }
    try {
      const session = createSession(db, {
        sessionId: input.sessionId,
        title: input.title,
        modelProfileSnapshot: input.modelProfileSnapshot,
        mcpProfileSnapshot: input.mcpProfileSnapshot ?? null,
        compactionStrategy: input.compactionStrategy ?? 'strip-reasoning',
      })
      return { kind: 'created', session }
    } catch (error) {
      if (error instanceof SessionIdInputError) return { kind: 'id_input_error', error }
      if (error instanceof SessionIdConflictError) return { kind: 'id_conflict_error', error }
      if (error instanceof SessionIdGenerationError) return { kind: 'id_generation_error', error }
      throw error
    }
  })()

  if (result.kind === 'blocked') {
    throw new OperationError(
      'Another session is currently active. Nothing was started.',
      'another_session_active',
      { id: result.active.id, state: result.active.state },
    )
  }
  if (result.kind === 'id_input_error') {
    throw new OperationError(result.error.message, 'invalid_session_id')
  }
  if (result.kind === 'id_conflict_error') {
    throw new OperationError(result.error.message, 'duplicate_session_id')
  }
  if (result.kind === 'id_generation_error') {
    throw new OperationError(result.error.message, 'session_id_generation_failed')
  }

  return { session: result.session }
}
