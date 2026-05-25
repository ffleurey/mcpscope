import { z } from 'zod'

export const listInputSchema = z.object({})

export type ListInput = z.infer<typeof listInputSchema>

/** Canonical snake_case session summary — used by both CLI and MCP results. */
export interface SessionSummary {
  id: string
  title: string
  status: string
  init_status: string
  created_at: number
  updated_at: number
  is_context_exhausted: boolean
  loaded_context_length: number | null
  compaction_strategy: string
  model_profile_snapshot: { name: string }
  mcp_profile_snapshot: { name: string } | null
}

export interface ListResult {
  api_version: 1
  sessions: SessionSummary[]
}

export const listOperation = {
  id: 'list' as const,
  description: 'List all sessions with ID, title, status, model, and last-updated time.',
  schema: listInputSchema,
}
