import { describe, expect, it } from 'vitest'
import type { PartRecord } from 'mcpscope-engine/domain/model.js'
import { selectFinalRoundContent } from './boundedTurn.js'

function makePart(overrides: Partial<PartRecord>): PartRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    sessionId: 'session-1',
    turnId: 'turn-1',
    roundId: overrides.roundId ?? null,
    parentPartId: null,
    ordinal: overrides.ordinal ?? 0,
    partType: overrides.partType ?? 'assistant-content',
    roleLabel: null,
    payload: {
      text: overrides.payload?.text ?? null,
      json: null,
      mimeType: null,
      summary: null,
    },
    display: { state: 'transcript', collapsedByDefault: false },
    context: { state: 'included', note: null, strippedByCompactionAtTurnId: null },
    tokens: { count: null, source: 'unknown', confidence: 'unknown', note: null },
    provenanceJson: null,
    createdAt: 0,
    updatedAt: 0,
  } as PartRecord
}

describe('selectFinalRoundContent', () => {
  // Regression: a tool-enabled judge turn emits prose in an intermediate round
  // ("Let me inspect…") then the JSON verdict in the final round. The parsed
  // response must be the final round only — concatenating the two breaks JSON.parse.
  it('returns only the final round assistant-content, ignoring intermediate rounds', () => {
    const parts = [
      makePart({ id: 'p1', roundId: 'r1', partType: 'assistant-content', payload: { text: 'Let me inspect the trace.' } as PartRecord['payload'] }),
      makePart({ id: 'p2', roundId: 'r2', partType: 'assistant-content', payload: { text: '{"criteria":[]}' } as PartRecord['payload'] }),
    ]
    const { responseText, assistantContentPartIds } = selectFinalRoundContent(parts, 'r2')
    expect(responseText).toBe('{"criteria":[]}')
    expect(assistantContentPartIds).toEqual(['p2'])
  })

  it('concatenates multiple assistant-content parts within the final round in order', () => {
    const parts = [
      makePart({ id: 'a', roundId: 'r2', ordinal: 0, payload: { text: '{"crit' } as PartRecord['payload'] }),
      makePart({ id: 'b', roundId: 'r2', ordinal: 1, payload: { text: 'eria":[]}' } as PartRecord['payload'] }),
    ]
    const { responseText, assistantContentPartIds } = selectFinalRoundContent(parts, 'r2')
    expect(responseText).toBe('{"criteria":[]}')
    expect(assistantContentPartIds).toEqual(['a', 'b'])
  })

  it('excludes non-assistant-content parts in the final round', () => {
    const parts = [
      makePart({ id: 'u', roundId: 'r2', partType: 'user-message', payload: { text: 'question' } as PartRecord['payload'] }),
      makePart({ id: 'reason', roundId: 'r2', partType: 'assistant-reasoning', payload: { text: 'thinking' } as PartRecord['payload'] }),
      makePart({ id: 'ans', roundId: 'r2', partType: 'assistant-content', payload: { text: '{}' } as PartRecord['payload'] }),
    ]
    const { responseText, assistantContentPartIds } = selectFinalRoundContent(parts, 'r2')
    expect(responseText).toBe('{}')
    expect(assistantContentPartIds).toEqual(['ans'])
  })
})
