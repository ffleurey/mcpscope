import { z } from 'zod'
import { listAllSessionSummaries, listTurnRecordsBySession, listStepRecordsBySession } from '../persistence/repository.js'
import type { OperationContext } from './context.js'
import {
  getAnalysisWorkflowKindFromSteps,
  getLatestAnalysisDiagnosticSummaryForSession,
  isAnalysisSessionTerminalError,
} from '../analysis/analysisSessionPresentation.js'

function toLifecycleState(
  ctx: OperationContext,
  summary: {
    id: string
    status: string
    initStatus: string
    sessionType: string
  },
): 'initializing' | 'ready' | 'running' | 'error' {
  const turns = listTurnRecordsBySession(ctx.db.connection, summary.id)
  const activeTurn = [...turns]
    .reverse()
    .find(t => t.status === 'draft' || t.status === 'streaming' || t.status === 'awaiting-tools')
    ?? null
  const latestTurn = turns.at(-1) ?? null

  if (isAnalysisSessionTerminalError(ctx.db.connection, summary) || latestTurn?.status === 'error') {
    return 'error'
  }
  if (summary.initStatus === 'error' || summary.status === 'error') {
    return 'error'
  }
  if (summary.initStatus === 'pending' || summary.initStatus === 'initializing') {
    return 'initializing'
  }
  if (activeTurn) {
    return 'running'
  }
  return 'ready'
}

// ─── Canonical contract ───────────────────────────────────────────────────────

export const listInputSchema = z.object({})

export type ListInput = z.infer<typeof listInputSchema>

/** Canonical snake_case session summary — used by both CLI rendering and MCP results. */
export interface SessionSummary {
  id: string
  title: string
  status: 'initializing' | 'ready' | 'running' | 'error'
  init_status: string
  session_type: string
  parent_kind: string | null
  parent_id: string | null
  created_at: number
  updated_at: number
  is_context_exhausted: boolean
  loaded_context_length: number | null
  compaction_strategy: string
  workflow_kind?: string
  latest_error?: { step_id: string | null; error_kind: string | null; message: string }
  model_profile_snapshot: { name: string }
  mcp_profile_snapshot: { name: string } | null
}

export interface ListResult {
  api_version: 1
  sessions: SessionSummary[]
}

/** Zod output shape for MCP structured output. Mirrors ListResult. */
export const listOutputSchema = {
  api_version: z.literal(1),
  sessions: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['initializing', 'ready', 'running', 'error']),
    init_status: z.string(),
    session_type: z.string(),
    parent_kind: z.string().nullable(),
    parent_id: z.string().nullable(),
    created_at: z.number(),
    updated_at: z.number(),
    is_context_exhausted: z.boolean(),
    loaded_context_length: z.number().nullable(),
    compaction_strategy: z.string(),
    workflow_kind: z.string().optional(),
    latest_error: z.object({
      step_id: z.string().nullable(),
      error_kind: z.string().nullable(),
      message: z.string(),
    }).optional(),
    model_profile_snapshot: z.object({ name: z.string() }),
    mcp_profile_snapshot: z.object({ name: z.string() }).nullable(),
  })),
}

export const listOperation = {
  id: 'list' as const,
  description: 'List all sessions with ID, title, status, model, and last-updated time.',
  schema: listInputSchema,
  outputSchema: listOutputSchema,
  async execute(ctx: OperationContext, _input: ListInput): Promise<ListResult> {
    const rows = listAllSessionSummaries(ctx.db.connection)
    return {
      api_version: 1,
      sessions: rows.map(s => {
        const workflowKind = s.sessionType === 'session_analysis'
          ? getAnalysisWorkflowKindFromSteps(listStepRecordsBySession(ctx.db.connection, s.id), ctx.db.connection, s.id)
          : null
        const latestError = toLifecycleState(ctx, s) === 'error' && s.sessionType === 'session_analysis'
          ? getLatestAnalysisDiagnosticSummaryForSession(ctx.db.connection, s.id) ?? undefined
          : undefined

        return {
          id: s.id,
          title: s.title,
          status: toLifecycleState(ctx, s),
          init_status: s.initStatus,
          session_type: s.sessionType,
          parent_kind: s.parentKind,
          parent_id: s.parentId,
          created_at: s.createdAt,
          updated_at: s.updatedAt,
          is_context_exhausted: s.isContextExhausted,
          loaded_context_length: s.loadedContextLength,
          compaction_strategy: s.compactionStrategy,
          ...(workflowKind ? { workflow_kind: workflowKind } : {}),
          ...(latestError ? { latest_error: latestError } : {}),
          model_profile_snapshot: { name: s.modelProfileSnapshot.name },
          mcp_profile_snapshot: s.mcpProfileSnapshot ? { name: s.mcpProfileSnapshot.name } : null,
        }
      }),
    }
  },
}
