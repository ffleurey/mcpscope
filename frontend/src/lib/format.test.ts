import { describe, expect, it } from 'vitest'
import { fmtTokens, isEstimatedTokens, normalizeMessageText, runStatusPillClass } from './format'

describe('normalizeMessageText', () => {
  it('strips leading and trailing blank lines but keeps inner ones', () => {
    expect(normalizeMessageText('\n \t\nhello\n\nworld\n \n')).toBe('hello\n\nworld')
  })

  it('returns null for empty, null, and whitespace-line-only input', () => {
    expect(normalizeMessageText(null)).toBeNull()
    expect(normalizeMessageText(undefined)).toBeNull()
    expect(normalizeMessageText('')).toBeNull()
    expect(normalizeMessageText('\n \n\t\n')).toBeNull()
  })
})

describe('isEstimatedTokens', () => {
  it('is true for estimated and unknown confidence, false for exact', () => {
    expect(isEstimatedTokens({ tokens: { confidence: 'estimated' } })).toBe(true)
    expect(isEstimatedTokens({ tokens: { confidence: 'unknown' } })).toBe(true)
    expect(isEstimatedTokens({ tokens: { confidence: 'exact' } })).toBe(false)
  })

  it('is false for null/undefined parts', () => {
    expect(isEstimatedTokens(null)).toBe(false)
    expect(isEstimatedTokens(undefined)).toBe(false)
  })
})

describe('fmtTokens', () => {
  it('formats counts with a locale separator and the tokens suffix', () => {
    expect(fmtTokens(1234)).toBe(`${(1234).toLocaleString()} tokens`)
  })

  it('prefixes ~ for estimated counts and returns "" for null', () => {
    expect(fmtTokens(1234, true)).toBe(`~${(1234).toLocaleString()} tokens`)
    expect(fmtTokens(null)).toBe('')
    expect(fmtTokens(null, true)).toBe('')
  })

  it('supports the short tk unit', () => {
    expect(fmtTokens(5509, false, 'tk')).toBe(`${(5509).toLocaleString()} tk`)
    expect(fmtTokens(5509, true, 'tk')).toBe(`~${(5509).toLocaleString()} tk`)
  })
})

describe('runStatusPillClass', () => {
  it('maps run statuses to pill color variants', () => {
    expect(runStatusPillClass('complete')).toBe('green')
    expect(runStatusPillClass('error')).toBe('red')
    expect(runStatusPillClass('running')).toBe('')
    expect(runStatusPillClass('paused')).toBe('')
    expect(runStatusPillClass('pending')).toBe('')
  })
})
