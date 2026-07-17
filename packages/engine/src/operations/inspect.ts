import { z } from 'zod'
import { OperationError } from './errors.js'
import { resolveHierarchicalId } from '../runtime/hierarchicalLookup.js'
import { renderInspect } from '../inspect/renderInspect.js'
import type { OperationContext } from './context.js'

// ─── Canonical contract ───────────────────────────────────────────────────────

export const inspectInputSchema = z.object({
  id: z.string().describe(
    'ID to inspect. Runtime formats: SSS (session), SSS.S (setup), '
    + 'SSS.NT (turn), SSS.NW or SSS.NC (deterministic step), SSS.W.NT.N (round), SSS.W.NT.N.N-X (part). Example: QGWA.4W.1T, QGWA.4W.1T.2, or QGWA.4W.1T.2.3-R. '
    + 'Benchmark formats: B-XXXX (benchmark), B-XXXX.N (case), R-XXXX (run; full mode adds the metrics report), E-XXXX (evaluation with scores). '
    + 'Inspecting a session, setup, turn, step, or round is useful for finding child IDs; '
    + 'inspect the returned part IDs directly for full evidence such as tool payloads, tool results, and part content.',
  ),
  short: z.boolean().optional().describe(
    'When true, omit part content and return token counts only. Parts always return full content regardless.',
  ),
  format: z.enum(['text', 'json']).optional().describe(
    'Output rendering. "text" (default) is a compact, human- and LLM-readable view. '
    + '"json" returns the full structured payload. The two carry the same information; '
    + 'text omits a few structural/plumbing fields for readability.',
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

/**
 * Inspect-ID resolver registry — the engine-side hook that lets the workbench
 * teach inspect about non-runtime ID families (benchmark B-/R-/E-) without the
 * engine importing benchmark code. Mirrors the session-executor registry in
 * `runtime/schedulerDispatch.ts`. A resolver returns null when the ID is not
 * one of its family, so inspect falls through to the runtime hierarchical
 * resolver. Registration is keyed so repeated startup wiring stays idempotent.
 */
export type InspectIdResolver = (
  ctx: OperationContext,
  id: string,
  mode: 'summary' | 'full',
) => InspectResult | null

const inspectIdResolvers = new Map<string, InspectIdResolver>()

export function registerInspectIdResolver(key: string, resolver: InspectIdResolver): void {
  inspectIdResolvers.set(key, resolver)
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

    // Registered ID families (e.g. the workbench's benchmark B-/R-/E- IDs)
    // resolve first; runtime IDs fall through below.
    for (const resolve of inspectIdResolvers.values()) {
      const resolved = resolve(ctx, input.id, mode)
      if (resolved) return resolved
    }

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
  /**
   * Render the structured result to the requested format for transport-level
   * surfaces (MCP). Text is the default; `json` returns the structural payload.
   * We return a single text channel (no `structuredContent`) so the payload is
   * never double-encoded over MCP.
   */
  renderContent(result: InspectResult, input: InspectInput): { text: string } {
    return { text: renderInspect(result, input.format ?? 'text') }
  },
}
