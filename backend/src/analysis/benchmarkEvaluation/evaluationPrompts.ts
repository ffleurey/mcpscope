import type { AnalysisTarget } from '../schemas.js'
import type { RubricCriterion } from 'mcpscope-engine/domain/model.js'

/**
 * The judge turn prompt: name the session to evaluate (by id — never paste its
 * content), present the rubric, and require a single JSON verdict awarding
 * points per criterion with an ID-citing note. The judge is tool-enabled and
 * pulls the session's request/answer/trace via mcpscope_inspect, so we hand it
 * the id and let it fetch — starting from the inspect summary.
 */
export function buildRubricJudgePrompt(params: {
  analysisTarget: AnalysisTarget
  rubric: RubricCriterion[]
}): string {
  const rubricLines = params.rubric.map(
    (c) => `- id ${c.id} (max ${c.points} pts): ${c.description}`,
  )

  const exampleVerdict = {
    criteria: [{ id: 1, points: 2, note: 'evidence + cited hierarchical IDs' }],
    comment: 'one-line overall note (optional)',
  }

  return [
    'Score the session below against the rubric.',
    '',
    `Session under evaluation: ${params.analysisTarget.target_session_id} (grade the final answer of in-scope turn ${params.analysisTarget.target_turn_id}).`,
    `Inspect it to read the request, the final answer, and the trace — call mcpscope_inspect with id "${params.analysisTarget.target_session_id}" first (default, not short); that returns the user request, the final answer, and each tool call with its parameters. Fetch a specific turn or part id only when a tool-use criterion needs a detail the session view omits (a tool result's values/row count, or a truncated parameter value).`,
    '',
    'Rubric (award 0..max points per criterion):',
    ...rubricLines,
    '',
    'Output requirements:',
    '- Return exactly one JSON object, no markdown wrapper.',
    '- One entry per rubric criterion, keyed by its id; points must be an integer in [0, max].',
    '- Each note must justify the award and cite the hierarchical IDs of the evidence used.',
    '',
    'Output schema:',
    JSON.stringify(exampleVerdict, null, 2),
  ].join('\n')
}
