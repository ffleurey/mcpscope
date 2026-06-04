import { describe, expect, it } from 'vitest'
import { formatPartId, formatRoundId, formatTurnId, parseHierarchicalId } from './hierarchicalIds.js'

describe('hierarchical ids', () => {
  it('formats and parses workflow-step-owned nested ids', () => {
    const ownerStepId = 'ABCD.4W'

    expect(formatTurnId('ABCD', 1, ownerStepId)).toBe('ABCD.4W.1T')
    expect(formatRoundId('ABCD', 1, 2, ownerStepId)).toBe('ABCD.4W.1T.2')
    expect(formatPartId('ABCD', 1, 2, 3, 'assistant-reasoning', ownerStepId)).toBe('ABCD.4W.1T.2.3-R')

    expect(parseHierarchicalId('ABCD.4W.1T')).toMatchObject({ type: 'turn', stepNumber: 4, turnNumber: 1, roundNumber: null, partNumber: null })
    expect(parseHierarchicalId('ABCD.4W.1T.2')).toMatchObject({ type: 'round', stepNumber: 4, turnNumber: 1, roundNumber: 2, partNumber: null })
    expect(parseHierarchicalId('ABCD.4W.1T.2.3-R')).toMatchObject({ type: 'part', stepNumber: 4, turnNumber: 1, roundNumber: 2, partNumber: 3 })
  })

  it('keeps direct session turns readable', () => {
    expect(formatTurnId('ABCD', 1)).toBe('ABCD.1T')
    expect(parseHierarchicalId('ABCD.1T')).toMatchObject({ type: 'turn', stepNumber: null, turnNumber: 1 })
  })
})