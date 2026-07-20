import { describe, expect, it } from 'vitest'
import {
  formatPartId,
  formatRoundId,
  formatTurnId,
  parseHierarchicalId,
} from './hierarchicalIds.js'

describe('hierarchical ids', () => {
  it('formats and parses workflow-step-owned nested ids', () => {
    const ownerStepId = 'ABCD.4W'

    expect(formatTurnId('ABCD', 1, ownerStepId)).toBe('ABCD.4W.1T')
    expect(formatRoundId('ABCD', 1, 2, ownerStepId)).toBe('ABCD.4W.1T.2')
    expect(formatPartId('ABCD', 1, 2, 3, 'assistant-reasoning', ownerStepId)).toBe(
      'ABCD.4W.1T.2.3-R',
    )

    expect(parseHierarchicalId('ABCD.4W.1T')).toMatchObject({
      type: 'turn',
      stepNumber: 4,
      turnNumber: 1,
      roundNumber: null,
      partNumber: null,
    })
    expect(parseHierarchicalId('ABCD.4W.1T.2')).toMatchObject({
      type: 'round',
      stepNumber: 4,
      turnNumber: 1,
      roundNumber: 2,
      partNumber: null,
    })
    expect(parseHierarchicalId('ABCD.4W.1T.2.3-R')).toMatchObject({
      type: 'part',
      stepNumber: 4,
      turnNumber: 1,
      roundNumber: 2,
      partNumber: 3,
    })
  })

  it('keeps direct session turns readable', () => {
    expect(formatTurnId('ABCD', 1)).toBe('ABCD.1T')
    expect(parseHierarchicalId('ABCD.1T')).toMatchObject({
      type: 'turn',
      stepNumber: null,
      turnNumber: 1,
    })
  })

  it('parses bare session, setup, and setup-part ids', () => {
    expect(parseHierarchicalId('ABCD')).toMatchObject({ type: 'session', sessionId: 'ABCD' })
    expect(parseHierarchicalId('ABCD.S')).toMatchObject({ type: 'setup', sessionId: 'ABCD' })
    expect(parseHierarchicalId('ABCD.S.2-TD')).toMatchObject({
      type: 'part',
      sessionId: 'ABCD',
      partNumber: 2,
      isSetupPart: true,
    })
  })

  it('parses compaction and workflow step ids', () => {
    expect(parseHierarchicalId('ABCD.2C')).toMatchObject({ type: 'step', stepNumber: 2 })
    expect(parseHierarchicalId('ABCD.4W')).toMatchObject({ type: 'step', stepNumber: 4 })
  })

  it('parses part-type suffixes on round parts', () => {
    expect(parseHierarchicalId('ABCD.1T.1.1-U')).toMatchObject({ type: 'part', partNumber: 1 })
    expect(parseHierarchicalId('ABCD.1T.2.3-T')).toMatchObject({
      type: 'part',
      roundNumber: 2,
      partNumber: 3,
    })
    expect(parseHierarchicalId('ABCD.1T.3.1-A')).toMatchObject({ type: 'part', partNumber: 1 })
  })

  it('rejects malformed ids', () => {
    for (const bad of [
      '',
      'ABCD.',
      'ABCD.0T',
      'ABCD.T',
      'ABCD.0C',
      'ABCD.1T.0',
      'ABCD.1T.1.0-U',
      'ABCD.1X',
    ]) {
      expect(parseHierarchicalId(bad), bad).toBeNull()
    }
  })
})
