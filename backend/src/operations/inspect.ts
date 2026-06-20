import { z } from 'zod'
import { OperationError } from './errors.js'
import { resolveHierarchicalId } from '../runtime/hierarchicalLookup.js'
import { resolveBenchmarkInspect } from './benchmarkOperations.js'
import type { OperationContext } from './context.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const inspectInputSchema = z.object({
  id: z.string().describe(
    'ID to inspect. Runtime formats: SSS (session), SSS.S (setup), '
    + 'SSS.NT (turn), SSS.NW or SSS.CN (deterministic step), SSS.W.NT.N (round), SSS.W.NT.N.N-X (part). Example: QGWA.4W.1T, QGWA.4W.1T.2, or QGWA.4W.1T.2.3-R. '
    + 'Benchmark formats: B-XXXX (benchmark), B-XXXX.N (case), R-XXXX (run; full mode adds the metrics report), E-XXXX (evaluation with scores). '
    + 'Inspecting a session, setup, turn, step, or round is useful for finding child IDs; '
    + 'inspect the returned part IDs directly for full evidence such as tool payloads, tool results, and part content.',
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

/** Zod output shape for MCP structured output. Mirrors InspectResult. */
export const inspectOutputSchema = {
  id: z.string(),
  type: z.string(),
  mode: z.string(),
  data: z.record(z.string(), z.unknown()),
}

export const inspectOperation = {
  id: 'inspect' as const,
  description:
    'Inspect any object by ID. Supports sessions, setups, deterministic steps, turns, rounds, and parts, '
    + 'plus benchmarks (B-), cases (B-.N), runs (R-), and evaluations (E-). '
    + 'Use session, turn, step, or round inspection to map the tree, then inspect returned part IDs directly for detailed evidence. '
    + 'Direct part inspection is how you read exact tool payloads/results and full part content. '
    + 'Use short=true to get token counts only without part content. '
    + 'Prefer inspecting specific turn or part IDs over full session dumps.',
  schema: inspectInputSchema,
  outputSchema: inspectOutputSchema,
  async execute(ctx: OperationContext, input: InspectInput): Promise<InspectResult> {
    const { db } = ctx
    const mode = input.short === true ? 'summary' : 'full'

    // Benchmark-family IDs (B-/R-/E-) resolve through the same snake_case payloads
    // as the dedicated benchmark_* operations; runtime IDs fall through below.
    const benchmark = resolveBenchmarkInspect(ctx, input.id, mode)
    if (benchmark) return benchmark

    const resolved = resolveHierarchicalId(db.connection, input.id, mode)

    if (resolved.status === 'invalid') {
      throw new OperationError(resolved.message, 'invalid_hierarchical_id')
    }
    if (resolved.status === 'not_found') {
      throw new OperationError(resolved.message, 'hierarchical_id_not_found')
    }

    return {
      id: resolved.payload.id,
      type: resolved.payload.type,
      mode: resolved.payload.mode,
      data: resolved.payload.data as Record<string, unknown>,
    }
  },
}
