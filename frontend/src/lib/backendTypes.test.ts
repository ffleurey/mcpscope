import { describe, it, expect } from 'vitest'
import { hierarchicalLookupResponseSchema, inspectTypeSchema } from './backendTypes'

// The id-pill lookup parses every inspect response against this schema. If the
// backend `inspect` op returns a `type` the enum doesn't list, the client throws
// a ZodError before the data ever renders — which is exactly what happened to the
// benchmark family. These tests pin the full set of inspectable object kinds.
const INSPECT_KINDS = [
  'session',
  'setup',
  'step',
  'turn',
  'round',
  'part',
  'benchmark',
  'benchmark_case',
  'benchmark_run',
  'benchmark_evaluation',
] as const

describe('hierarchicalLookupResponseSchema (inspect contract)', () => {
  it.each(INSPECT_KINDS)('accepts an inspect response of type "%s"', (type) => {
    const result = hierarchicalLookupResponseSchema.safeParse({
      id: 'X-1',
      type,
      mode: 'full',
      data: {},
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown object type', () => {
    const result = hierarchicalLookupResponseSchema.safeParse({
      id: 'X-1',
      type: 'galaxy',
      mode: 'full',
      data: {},
    })
    expect(result.success).toBe(false)
  })

  it('lists exactly the known inspectable kinds (drift guard)', () => {
    expect([...inspectTypeSchema.options].sort()).toEqual([...INSPECT_KINDS].sort())
  })
})
