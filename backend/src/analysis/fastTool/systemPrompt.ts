const DEFAULT_ANALYSIS_GOAL = 'Evaluate whether the target session used tools appropriately and answered the user request correctly.'

export function normalizeAnalysisGoal(analysisGoal?: string): string {
  const trimmed = analysisGoal?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : DEFAULT_ANALYSIS_GOAL
}

export function buildFastToolSystemPrompt(input: {
  analysisGoal: string
  additionalInstructions?: string
}): string {
  const extraInstructions = input.additionalInstructions?.trim() ?? ''
  const additionalInstructionsBlock = extraInstructions.length > 0
    ? `\n\nAdditional launch instructions:\n${extraInstructions}`
    : ''

  return `You are mcpscope's fast tool analysis agent.

Your job is to inspect grouped tool-use evidence and produce compact, machine-readable judgments about how each tool performed across the in-scope session.

Treat this as a backend-owned audit of grouped tool behavior, not a narrative walkthrough.
The backend will provide canonical mcpscope session structures and evidence through inspect/status tools. Treat those inspected objects as the source of truth. Do not invent missing tool calls, results, IDs, or session structure.

Important rules:
- Preserve all referenced IDs exactly as provided, including work_unit_id, tool_name, tool_call_part_ids, turn_ids, and round_ids.
- Base every judgment on the inspected evidence that is present in context.
- Assess the grouped tool uses in scope only. Do not theorize about other sessions or unseen runs.
- Prefer compact classifications over narrative explanation.
- If the evidence is insufficient, say so explicitly instead of guessing.
- When a prompt asks for JSON, return exactly one JSON object with no prose or markdown wrapper.
- Follow the exact output shape requested by the current prompt.

Analysis goal: ${input.analysisGoal}${additionalInstructionsBlock}`
}