import { z } from 'zod'

export const inspectInputSchema = z.object({
  id: z.string().describe(
    'Hierarchical ID to inspect. Formats: SSS (session), SSS.S (setup), '
    + 'SSS.N (turn), SSS.N.N (round), SSS.N.N.N-X (part). Example: QGWA.1.2',
  ),
  short: z.boolean().optional().describe(
    'When true, omit part content and return token counts only. Parts always return full content regardless.',
  ),
})

export type InspectInput = z.infer<typeof inspectInputSchema>

export interface InspectResult {
  id: string
  type: string
  mode: string
  data: Record<string, unknown>
}

export const inspectOperation = {
  id: 'inspect' as const,
  description:
    'Inspect any object by hierarchical ID. Supports sessions, setups, turns, rounds, and parts. '
    + 'Use short=true to get token counts only without part content. '
    + 'Prefer inspecting specific turn or part IDs over full session dumps.',
  schema: inspectInputSchema,
}
