import { z } from 'zod'
import { startTurn } from '../httpClient.js'

export const sendInputSchema = z.object({
  session_id: z.string().describe('Session ID to send the prompt to'),
  prompt: z.string().min(1).describe('User prompt text to submit to the session'),
})

export type SendInput = z.infer<typeof sendInputSchema>

export interface SendResult {
  api_version: 1
  session_id: string
  turn: { id: string; status: string }
}

export const sendOperation = {
  id: 'send' as const,
  description:
    'Start a user turn for an existing session (non-streaming, returns immediately). '
    + 'The session must be fully initialized (status=ready). '
    + 'Poll with status after sending to track turn progress.',
  schema: sendInputSchema,
  async execute(baseUrl: string, input: SendInput): Promise<SendResult> {
    const result = await startTurn(baseUrl, input.session_id, input.prompt)
    return {
      api_version: 1,
      session_id: result.sessionId,
      turn: { id: result.turn.id, status: result.turn.status },
    }
  },
}
