import { describe, expect, it } from 'vitest'
import type { RubricCriterion } from 'mcpscope-engine/domain/model.js'
import { benchmarkVerdictSchema, clampVerdictToRubric } from './schemas.js'

const rubric: RubricCriterion[] = [
  { id: 1, description: 'Correct temperature returned', points: 2 },
  { id: 2, description: 'Sensor resolved in one discovery call', points: 2 },
  { id: 3, description: 'Total tool calls <= 2', points: 1 },
]

describe('clampVerdictToRubric', () => {
  it('clamps over-cap points down to each criterion max', () => {
    const out = clampVerdictToRubric(rubric, {
      criteria: [
        { id: 1, points: 5, note: 'judge over-awarded' }, // cap 2
        { id: 2, points: 2, note: 'ok' },
        { id: 3, points: 1, note: 'ok' },
      ],
    })
    expect(out.criteria.map((c) => c.points)).toEqual([2, 2, 1])
  })

  it('fills missing criteria with 0 points and an empty note, in rubric order', () => {
    const out = clampVerdictToRubric(rubric, {
      criteria: [{ id: 2, points: 2, note: 'only scored #2' }],
    })
    expect(out.criteria).toEqual([
      { id: 1, points: 0, note: '' },
      { id: 2, points: 2, note: 'only scored #2' },
      { id: 3, points: 0, note: '' },
    ])
  })

  it('ignores unknown criterion ids and clamps negatives to 0', () => {
    const out = clampVerdictToRubric(rubric, {
      criteria: [
        { id: 1, points: -3, note: 'negative' },
        { id: 99, points: 2, note: 'not in rubric' },
      ],
    })
    expect(out.criteria).toEqual([
      { id: 1, points: 0, note: 'negative' },
      { id: 2, points: 0, note: '' },
      { id: 3, points: 0, note: '' },
    ])
  })

  it('preserves an optional overall comment', () => {
    const out = clampVerdictToRubric(rubric, { criteria: [], comment: 'overall ok' })
    expect(out.comment).toBe('overall ok')
  })
})

describe('benchmarkVerdictSchema', () => {
  it('accepts a well-formed verdict', () => {
    expect(
      benchmarkVerdictSchema.safeParse({
        criteria: [{ id: 1, points: 2, note: 'cited ABCD.2W.1T.4-R' }],
        comment: 'good',
      }).success,
    ).toBe(true)
  })

  it('rejects non-integer / non-string fields', () => {
    expect(benchmarkVerdictSchema.safeParse({ criteria: [{ id: 1, points: '2', note: 'x' }] }).success).toBe(false)
    expect(benchmarkVerdictSchema.safeParse({ criteria: [{ id: 1, points: 2 }] }).success).toBe(false)
  })
})
