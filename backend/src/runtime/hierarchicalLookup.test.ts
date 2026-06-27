import { describe, expect, it } from 'vitest'
import {
  summarizeToolArguments,
  TOOL_ARG_VALUE_MAX_CHARS,
} from './hierarchicalLookup.js'

describe('summarizeToolArguments', () => {
  it('keeps every key and short value intact', () => {
    const args = JSON.stringify({
      entity: 'sensor.charger',
      interval: 'day',
      filter_operator: '>',
      filter_value: 20,
    })
    expect(summarizeToolArguments(args)).toEqual({
      entity: 'sensor.charger',
      interval: 'day',
      filter_operator: '>',
      filter_value: 20,
    })
  })

  it('caps an oversized string value but leaves siblings intact', () => {
    const big = 'x'.repeat(200)
    const result = summarizeToolArguments(
      JSON.stringify({ note: big, interval: 'day' }),
    ) as Record<string, string>
    const note = String(result.note)
    expect(result.interval).toBe('day')
    expect(note).toBe(`${'x'.repeat(TOOL_ARG_VALUE_MAX_CHARS)}… [200 chars]`)
    // The capped marker keeps the value bounded regardless of input size.
    expect(note.length).toBeLessThan(big.length)
  })

  it('caps a large non-string value via its serialized form', () => {
    const result = summarizeToolArguments(
      JSON.stringify({ entity_ids: Array.from({ length: 50 }, (_, i) => `e${i}`) }),
    ) as Record<string, string>
    const entityIds = String(result.entity_ids)
    expect(typeof result.entity_ids).toBe('string')
    expect(entityIds).toMatch(/… \[\d+ chars\]$/)
  })

  it('falls back to a capped raw string when arguments are not JSON', () => {
    expect(summarizeToolArguments('not json')).toBe('not json')
    expect(summarizeToolArguments('a'.repeat(100))).toBe(
      `${'a'.repeat(TOOL_ARG_VALUE_MAX_CHARS)}… [100 chars]`,
    )
  })

  it('treats missing arguments as an empty object', () => {
    expect(summarizeToolArguments(undefined)).toEqual({})
  })
})
