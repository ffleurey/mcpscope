/**
 * Context-aware LLM turn runner for analysis sessions.
 *
 * Delegates to createToolEnabledTurn so that the analysis LLM has access to
 * mcpscope_inspect and mcpscope_status during each turn. The orchestration
 * step injects the user prompt; the LLM may call tools autonomously if needed.
 *
 * Returns an AnalysisTurnResult adapting the RuntimeTurnResult for callers
 * that need responseText, turnId, and assistantReasoningPartIds.
 */

import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { createToolEnabledTurn } from '../runtime/toolTurns.js'
import type { TurnStreamEventSink } from '../runtime/streamEvents.js'

export interface AnalysisTurnResult {
  turnId: string
  roundId: string
  userPartId: string
  assistantContentPartIds: string[]
  assistantReasoningPartIds: string[]
  responseText: string
}

/**
 * Runs a tool-enabled LLM turn for the analysis session.
 *
 * The analysis session must have an mcpProfileSnapshot set (pointing to
 * /mcp/analysis) so that the LLM can call inspect and status tools.
 *
 * The caller is responsible for inserting any inject evidence parts into the
 * analysis session BEFORE calling this function so they appear in context.
 */
export async function runAnalysisTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  analysisSessionId: string,
  userContent: string,
  emitEvent?: TurnStreamEventSink,
): Promise<AnalysisTurnResult> {
  const result = await createToolEnabledTurn(
    database,
    lmGateway,
    mcpGateway,
    {
      sessionId: analysisSessionId,
      userContent,
      maxToolRounds: 5,
    },
    emitEvent,
  )

  const { turn, round, parts } = result

  // Collect turn-level response text from all assistant-content parts
  const responseText = parts
    .filter(p => p.partType === 'assistant-content' && p.payload.text)
    .map(p => p.payload.text ?? '')
    .join('')
    .trim()

  const userPartId = parts.find(p => p.partType === 'user-message')?.id ?? ''
  const assistantContentPartIds = parts
    .filter(p => p.partType === 'assistant-content')
    .map(p => p.id)
  const assistantReasoningPartIds = parts
    .filter(p => p.partType === 'assistant-reasoning')
    .map(p => p.id)

  // Use the last round's ID so callers that reference the final response round
  // get the correct round even when the LLM made multiple tool-call rounds.
  const finalRound = result.rounds.at(-1) ?? round

  return {
    turnId: turn.id,
    roundId: finalRound.id,
    userPartId,
    assistantContentPartIds,
    assistantReasoningPartIds,
    responseText,
  }
}
