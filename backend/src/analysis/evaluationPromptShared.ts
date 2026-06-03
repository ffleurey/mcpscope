function buildSharedEvaluationOutputBlock(subjectScope: string, subjectId: string): string {
  return `{
  "subject_scope": ${JSON.stringify(subjectScope)},
  "subject_id": ${JSON.stringify(subjectId)},
  "evaluation_focus": "string",
  "reasoning": "string",
  "verdict": "pass|partial|fail|unclear",
  "score": 0,
  "evidence_part_id": "string|null"
}`
}

function buildEvaluationRubricBlock(): string {
  return [
    'Score 5 (Verdict: pass): The target clearly satisfies the requested evaluation focus with no material issues.',
    'Score 4 (Verdict: partial): The target mostly satisfies the evaluation focus, with only minor issues or inefficiency.',
    'Score 3 (Verdict: partial): The result is mixed or only partially successful.',
    'Score 2 (Verdict: fail): The target fails mainly because of design, context, or execution problems.',
    'Score 1 (Verdict: fail): The target fails mainly because the model made a substantive mistake.',
    'Score 0 (Verdict: fail): The response is broken, malformed, or the context is unusable.',
  ].join('\n')
}

export function buildSharedEvaluationPrompt(params: {
  title: string
  subjectScope: string
  subjectId: string
  evaluationFocus: string
  contextBlock?: string
  extraInstructions?: string
}): string {
  const sections = [
    `You are evaluating ${params.title}.`,
    '',
    'Use the context already present in the conversation and the evidence parts injected by the harness.',
    params.extraInstructions ? ['', params.extraInstructions] : [],
    '',
    'Evaluation focus:',
    params.evaluationFocus,
    '',
    'Output requirements:',
    '- Return one JSON object only.',
    '- Put reasoning before score in the reasoning field so the score stays anchored to the explanation.',
    '- Keep the reasoning concise, evidence-based, and specific to the subject under review.',
    '- Use `evidence_part_id` for the single strongest supporting part when one is available; otherwise return `null`.',
    '',
    'Rubric:',
    buildEvaluationRubricBlock(),
    '',
    'Output schema:',
    buildSharedEvaluationOutputBlock(params.subjectScope, params.subjectId),
  ]

  if (params.contextBlock) {
    sections.splice(2, 0, '', params.contextBlock)
  }

  return sections.flat().join('\n')
}
