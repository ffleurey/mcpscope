import { z } from 'zod'
import { inspectInputSchema } from '@mcpscope/shared'
import type { InspectInput, InspectResult } from '@mcpscope/shared'
import { inspectOperation as inspectContract } from '@mcpscope/shared'
import { OperationError } from '@mcpscope/shared'
import { resolveHierarchicalId } from '../runtime/hierarchicalLookup.js'
import type { OperationContext } from './context.js'

export type { InspectInput, InspectResult }

/** Zod output shape for MCP structured output. Mirrors InspectResult. */
export const inspectOutputSchema = {
  id: z.string(),
  type: z.string(),
  mode: z.string(),
  data: z.record(z.string(), z.unknown()),
}

export const inspectOperation = {
  ...inspectContract,
  outputSchema: inspectOutputSchema,
  async execute(ctx: OperationContext, input: InspectInput): Promise<InspectResult> {
    const { db } = ctx
    const mode = input.short === true ? 'summary' : 'full'
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

export { inspectInputSchema }
