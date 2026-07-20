import { describe, expect, it } from 'vitest'
import type { PartRecord, RoundRecord } from 'mcpscope-engine/domain/model.js'
import {
  selectFinalRoundContent,
  turnCalledInspect,
  turnHasFinalAnswer,
} from './boundedTurn.js'

function makeRound(id: string, turnId: string, roundIndex: number): RoundRecord {
  return { id, turnId, roundIndex } as RoundRecord
}

function makeToolCallPart(overrides: Partial<PartRecord> & { toolName?: string }): PartRecord {
  const part = makePart({ ...overrides, partType: 'tool-call' })
  part.payload = { text: null, json: { name: overrides.toolName }, mimeType: null, summary: null }
  return part
}

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

describe('turnHasFinalAnswer', () => {
  const rounds = [makeRound('r1', 't1', 0), makeRound('r2', 't1', 1)]

  it('is true when the final round has non-empty assistant-content', () => {
    const parts = [
      makePart({ roundId: 'r1', partType: 'assistant-content', payload: { text: 'inspecting' } as PartRecord['payload'] }),
      makePart({ roundId: 'r2', partType: 'assistant-content', payload: { text: 'The answer is 42.' } as PartRecord['payload'] }),
    ]
    expect(turnHasFinalAnswer(parts, rounds, 't1')).toBe(true)
  })

  it('is false when the final round produced only reasoning / a tool call (no content)', () => {
    const parts = [
      makePart({ roundId: 'r2', partType: 'assistant-reasoning', payload: { text: 'thought but never answered' } as PartRecord['payload'] }),
    ]
    expect(turnHasFinalAnswer(parts, rounds, 't1')).toBe(false)
  })

  it('is false when the turn has no rounds', () => {
    expect(turnHasFinalAnswer([], [], 't1')).toBe(false)
  })

  it('ignores an answer in an earlier round when the final round is empty', () => {
    const parts = [
      makePart({ roundId: 'r1', partType: 'assistant-content', payload: { text: 'stray intermediate prose' } as PartRecord['payload'] }),
    ]
    expect(turnHasFinalAnswer(parts, rounds, 't1')).toBe(false)
  })
})

describe('turnCalledInspect', () => {
  const rounds = [makeRound('r1', 't1', 0), makeRound('r2', 't1', 1)]

  it('is true when the turn issued at least one mcpscope_inspect call', () => {
    const parts = [
      makeToolCallPart({ roundId: 'r1', toolName: 'mcpscope_inspect' }),
      makePart({ roundId: 'r2', partType: 'assistant-content', payload: { text: '{}' } as PartRecord['payload'] }),
    ]
    expect(turnCalledInspect(parts, rounds, 't1')).toBe(true)
  })

  it('is false when the judge answered with zero tool calls (the fabrication case)', () => {
    const parts = [
      makePart({ roundId: 'r1', partType: 'assistant-content', payload: { text: '{"criteria":[]}' } as PartRecord['payload'] }),
    ]
    expect(turnCalledInspect(parts, rounds, 't1')).toBe(false)
  })

  it('is false when the only tool call is a non-inspect tool (e.g. status)', () => {
    const parts = [makeToolCallPart({ roundId: 'r1', toolName: 'mcpscope_status' })]
    expect(turnCalledInspect(parts, rounds, 't1')).toBe(false)
  })

  it('ignores inspect calls from a different turn', () => {
    const parts = [makeToolCallPart({ roundId: 'rX', toolName: 'mcpscope_inspect' })]
    expect(turnCalledInspect(parts, rounds, 't1')).toBe(false)
  })
})
