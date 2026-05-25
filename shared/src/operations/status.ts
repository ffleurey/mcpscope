import { z } from 'zod'
import { getSessionStatus } from '../httpClient.js'

export const statusInputSchema = z.object({
  session_id: z.string().describe('Session ID to check'),
})

export type StatusInput = z.infer<typeof statusInputSchema>

export interface StatusResult {
  api_version: 1
  session: { id: string; state: 'initializing' | 'ready' | 'running' | 'error' }
  active_turn: { id: string; status: string } | null
}

export const statusOperation = {
  id: 'status' as const,
  description:
    'Get the current lifecycle state of a session. '
    + 'States: initializing (setup in progress), ready (can accept a prompt), '
    + 'running (turn in progress), error (failed state).',
  schema: statusInputSchema,
  async execute(baseUrl: string, input: StatusInput): Promise<StatusResult> {
    const result = await getSessionStatus(baseUrl, input.session_id)
    return {
      api_version: 1,
      session: { id: result.session.id, state: result.session.state },
      active_turn: result.activeTurn
        ? { id: result.activeTurn.id, status: result.activeTurn.status }
        : null,
    }
  },
}
