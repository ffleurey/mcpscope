import { z } from 'zod'

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
}
