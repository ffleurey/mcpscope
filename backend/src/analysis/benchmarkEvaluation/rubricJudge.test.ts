import { describe, expect, it } from 'vitest'
import type { RubricCriterion } from 'mcpscope-engine/domain/model.js'
import { benchmarkVerdictSchema, clampVerdictToRubric } from './schemas.js'
import { buildRubricJudgePrompt } from './evaluationPrompts.js'
import { buildBenchmarkEvaluationSystemPrompt } from './systemPrompt.js'

const rubric: RubricCriterion[] = [
  { id: 1, description: 'Correct temperature returned', points: 2 },
  { id: 2, description: 'Sensor resolved in one discovery call', points: 2 },
  { id: 3, description: 'Total tool calls <= 2', points: 1 },
]

describe('judge prompts steer the no-answer case to score 0 without hunting', () => {
  it('the system prompt tells the judge a "no final answer" turn is fully settled at 0', () => {
    const prompt = buildBenchmarkEvaluationSystemPrompt({ analysisGoal: 'Score the session.' })
    expect(prompt).toMatch(/no final answer/i)
    // It must not keep inspecting for an answer that was never produced.
    expect(prompt).toMatch(/do not inspect further/i)
  })

  it('the turn prompt does not promise an answer exists and handles its absence', () => {
    const prompt = buildRubricJudgePrompt({
      analysisTarget: {
        target_session_id: 'ABCD',
        target_turn_id: 'ABCD.1T',
        analysis_goal: 'Score the session.',
        selected_tool_names: [],
        only_failed_tool_calls: false,
        evaluation_criteria: [],
        analyzed_turn_ids: ['ABCD.1T'],
        target_mcp_instructions_part_id: null,
        target_tool_definitions_part_id: null,
        user_request_part_id: null,
        final_answer_part_id: null,
      },
      rubric,
    })
    expect(prompt).toMatch(/no final answer/i)
    expect(prompt).toMatch(/award 0 to every answer-content criterion/i)
  })
})

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
