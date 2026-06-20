import type { AnalysisTarget } from '../schemas.js'
import { buildAnalysisFocusInstructions } from '../schemas.js'
import type { RubricCriterion } from '../../domain/model.js'

/**
 * The judge turn prompt: present the rubric (id, max points, description) and
 * the evaluation focus, and require a single JSON verdict awarding points per
 * criterion with an ID-citing note. The session content is already in context
 * (pushed by the bootstrap step); the judge may pull more via inspect.
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
    'Score the in-scope session against the rubric below.',
    '',
    'Evaluation focus:',
    buildAnalysisFocusInstructions(params.analysisTarget),
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
