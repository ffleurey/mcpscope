import { describe, expect, it } from 'vitest'
import {
  deriveSessionTerminalStatus,
  getTerminalTurnError,
  summarizeToolArguments,
  TOOL_ARG_VALUE_MAX_CHARS,
} from './hierarchicalLookup.js'
import type { TurnRecord } from '../domain/model.js'

function erroredTurn(turnNumber: number, outcome: string | null): TurnRecord {
  return {
    id: `S1.${turnNumber}T`,
    sessionId: 'S1',
    ownerStepId: null,
    turnNumber,
    status: 'error',
    createdAt: 1,
    completedAt: 2,
    outcome,
    usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
    contextTokensAtTurnEnd: null,
    contextTokensAfterCompaction: null,
    compactionApplied: null,
    compactionTokensRemoved: null,
  }
}

describe('deriveSessionTerminalStatus', () => {
  const ok = { initStatus: 'ready', status: 'active' }
  const turn = (turnNumber: number, status: string) => ({ turnNumber, status })

  it('reports the last turn status for a healthy session', () => {
    expect(deriveSessionTerminalStatus(ok, [turn(0, 'complete'), turn(1, 'complete')], null)).toBe(
      'complete',
    )
  })

  it('is error when the last turn errored (primary loop/cap failure)', () => {
    expect(deriveSessionTerminalStatus(ok, [turn(0, 'complete'), turn(1, 'error')], null)).toBe(
      'error',
    )
  })

  it('is error when init failed, regardless of turns', () => {
    expect(
      deriveSessionTerminalStatus(
        { initStatus: 'error', status: 'error', initError: { errorKind: 'mcp', message: 'x' } },
        [],
        null,
      ),
    ).toBe('error')
  })

  it('is error when the analysis workflow ended in error', () => {
    expect(deriveSessionTerminalStatus(ok, [turn(0, 'complete')], 'error')).toBe('error')
  })

  it('falls back to the session status when there are no turns', () => {
    expect(deriveSessionTerminalStatus(ok, [], null)).toBe('active')
  })
})

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
    const result = summarizeToolArguments(JSON.stringify({ note: big, interval: 'day' })) as Record<
      string,
      string
    >
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

describe('getTerminalTurnError', () => {
  it('keeps error_kind a short constant instead of duplicating the message', () => {
    // Regression: error_kind used to be set to the full `step-error: <message>`
    // outcome string, and every renderer (CLI, GUI) concatenates error_kind
    // right next to message, so a real error like "Connection reset" rendered
    // twice: "step-error: Connection reset: Connection reset".
    const result = getTerminalTurnError([erroredTurn(2, 'step-error: Connection reset by peer')])
    expect(result).toEqual({
      step_id: 'S1.2T',
      error_kind: 'step-error',
      message: 'Connection reset by peer',
    })
  })

  it('falls back to a generic message for a bare outcome marker (pre-migration data)', () => {
    const result = getTerminalTurnError([erroredTurn(1, 'tool-loop-limit:8')])
    expect(result).toEqual({
      step_id: 'S1.1T',
      error_kind: 'tool-loop-limit:8',
      message: 'Turn 1 ended in error.',
    })
  })

  it('returns null when no turn errored', () => {
    const complete: TurnRecord = { ...erroredTurn(1, null), status: 'complete' }
    expect(getTerminalTurnError([complete])).toBeNull()
  })

  it('picks the latest errored turn by turn number', () => {
    const result = getTerminalTurnError([
      erroredTurn(1, 'step-error: first failure'),
      erroredTurn(3, 'step-error: latest failure'),
      erroredTurn(2, 'step-error: middle failure'),
    ])
    expect(result?.message).toBe('latest failure')
  })
})
