import { z } from 'zod'
import { listSessions } from '../httpClient.js'
import type { SessionSummary } from '../httpClient.js'

export { type SessionSummary }

export const listInputSchema = z.object({})

export type ListInput = z.infer<typeof listInputSchema>

export interface ListResult {
  api_version: 1
  sessions: SessionSummary[]
}

export const listOperation = {
  id: 'list' as const,
  description: 'List all sessions with ID, title, status, model, and last-updated time.',
  schema: listInputSchema,
  async execute(baseUrl: string, _input: ListInput): Promise<ListResult> {
    const result = await listSessions(baseUrl)
    return { api_version: 1, sessions: result.sessions }
  },
}
