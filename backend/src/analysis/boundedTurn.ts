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

import type { PartRecord } from '../domain/model.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { ChatCompletionGateway } from '../runtime/modelTurns.js'
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
 * Selects the model's FINAL answer from a tool-enabled turn.
 *
 * A tool-enabled turn can emit assistant-content in intermediate rounds (e.g.
 * "Let me inspect the trace…") alongside its tool calls. Concatenating that
 * intermediate prose with the final round's text corrupts the JSON that judge /
 * analysis callers parse, so we scope to the final round, which holds the
 * end-of-turn answer. Callers should wait for the turn to finish and parse this.
 */
export function selectFinalRoundContent(
  parts: PartRecord[],
  finalRoundId: string,
): { responseText: string; assistantContentPartIds: string[] } {
  const finalContentParts = parts.filter(
    p => p.roundId === finalRoundId && p.partType === 'assistant-content',
  )
  const responseText = finalContentParts
    .filter(p => p.payload.text)
    .map(p => p.payload.text ?? '')
    .join('')
    .trim()
  return { responseText, assistantContentPartIds: finalContentParts.map(p => p.id) }
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
  lmGateway: ChatCompletionGateway,
  mcpGateway: McpGateway,
  analysisSessionId: string,
  userContent: string,
  emitEvent?: TurnStreamEventSink,
  ownerStepId?: string | null,
): Promise<AnalysisTurnResult> {
  const result = await createToolEnabledTurn(
    database,
    lmGateway,
    mcpGateway,
    {
      sessionId: analysisSessionId,
      userContent,
      maxToolRounds: 50,
      ownerStepId,
    },
    emitEvent,
  )

  const { turn, round, parts } = result

  // Use the last round's ID so callers that reference the final response round
  // get the correct round even when the LLM made multiple tool-call rounds.
  const finalRound = result.rounds.at(-1) ?? round

  const { responseText, assistantContentPartIds } = selectFinalRoundContent(parts, finalRound.id)

  const userPartId = parts.find(p => p.partType === 'user-message')?.id ?? ''
  const assistantReasoningPartIds = parts
    .filter(p => p.partType === 'assistant-reasoning')
    .map(p => p.id)

  return {
    turnId: turn.id,
    roundId: finalRound.id,
    userPartId,
    assistantContentPartIds,
    assistantReasoningPartIds,
    responseText,
  }
}
