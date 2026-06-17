import { z } from 'zod'
import { OperationError } from './errors.js'
import { getSessionRecord, listTurnRecordsBySession, listStepRecordsBySession } from '../persistence/repository.js'
import type { OperationContext } from './context.js'
import { computeLifecycleState } from './lifecycleState.js'
import {
  getAnalysisWorkflowKindFromSteps,
  getLatestAnalysisDiagnosticSummaryForSession,
} from '../analysis/analysisSessionPresentation.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const statusInputSchema = z.object({
  session_id: z.string().describe('Session ID to check'),
})

export type StatusInput = z.infer<typeof statusInputSchema>

export interface StatusResult {
  api_version: 1
  session: {
    id: string
    state: 'initializing' | 'ready' | 'running' | 'error'
    workflow_kind?: string
    latest_error?: { step_id: string | null; error_kind: string | null; message: string }
  }
  active_turn: { id: string; status: string } | null
}

/** Zod output shape for MCP structured output. Mirrors StatusResult. */
export const statusOutputSchema = {
  api_version: z.literal(1),
  session: z.object({
    id: z.string(),
    state: z.enum(['initializing', 'ready', 'running', 'error']),
    workflow_kind: z.string().optional(),
    latest_error: z.object({
      step_id: z.string().nullable(),
      error_kind: z.string().nullable(),
      message: z.string(),
    }).optional(),
  }),
  active_turn: z.object({ id: z.string(), status: z.string() }).nullable(),
}

export const statusOperation = {
  id: 'status' as const,
  description:
    'Get the current lifecycle state of a session. '
    + 'States: initializing (setup in progress), ready (can accept a prompt), '
    + 'running (turn in progress), error (failed state).',
  schema: statusInputSchema,
  outputSchema: statusOutputSchema,
  async execute(ctx: OperationContext, input: StatusInput): Promise<StatusResult> {
    const { db } = ctx
    const session = getSessionRecord(db.connection, input.session_id)
    if (!session) {
      throw new OperationError('Session not found', 'session_not_found')
    }

    const turns = listTurnRecordsBySession(db.connection, input.session_id)
    const activeTurn = [...turns]
      .reverse()
      .find(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
      ?? null
    const latestTurn = turns.at(-1) ?? null

    const workflowSteps = session.sessionType === 'session_analysis'
      ? listStepRecordsBySession(db.connection, input.session_id)
      : []

    const state = computeLifecycleState(db.connection, session)

    const relevantTurn = state === 'running'
      ? activeTurn
      : state === 'error'
        ? latestTurn
        : null

    const workflowKind = getAnalysisWorkflowKindFromSteps(workflowSteps, db.connection, input.session_id)
    const latestError = state === 'error' && session.sessionType === 'session_analysis'
      ? getLatestAnalysisDiagnosticSummaryForSession(db.connection, session.id) ?? undefined
      : undefined

    return {
      api_version: 1,
      session: {
        id: session.id,
        state,
        ...(workflowKind ? { workflow_kind: workflowKind } : {}),
        ...(latestError ? { latest_error: latestError } : {}),
      },
      active_turn: relevantTurn
        ? { id: relevantTurn.id, status: relevantTurn.status }
        : null,
    }
  },
}
