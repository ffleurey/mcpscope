import type { BackendDatabase } from '../persistence/db.js'
import {
  getSessionRecord,
  getTurnRecord,
  listPartRecordsBySession,
  listRoundRecordsBySession,
  listTurnRecordsBySession,
} from '../persistence/repository.js'
import {
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvidencePacket,
  type FastToolWorkIndex,
  type FastToolWorkGroup,
} from './schemas.js'

export interface AnalysisPlanningData {
  analysisTarget: AnalysisTarget
  packets: EvidencePacket[]
  bootstrapInspectIds: string[]
}

export function collectAnalysisPlanningData(
  database: BackendDatabase,
  state: AnalysisSessionState,
): AnalysisPlanningData {
  const {
    targetSessionId,
    targetTurnId,
    analysisGoal,
    selectedToolNames,
    onlyFailedToolCalls,
    evaluationCriteria,
  } = state

  const targetSession = getSessionRecord(database.connection, targetSessionId)
  if (!targetSession) {
    throw new Error(`Planning: target session not found: ${targetSessionId}`)
  }

  const targetTurn = getTurnRecord(database.connection, targetTurnId)
  if (!targetTurn) {
    throw new Error(`Planning: target turn not found: ${targetTurnId}`)
  }
  if (targetTurn.status !== 'complete') {
    throw new Error(`Planning: target turn ${targetTurnId} is not complete (status: ${targetTurn.status})`)
  }

  const allTurns = listTurnRecordsBySession(database.connection, targetSessionId)
  const targetTurnIndex = allTurns.findIndex(turn => turn.id === targetTurnId)
  if (targetTurnIndex === -1) {
    throw new Error(`Planning: target turn ${targetTurnId} not found in session ${targetSessionId}`)
  }
  const inScopeTurns = allTurns.slice(0, targetTurnIndex + 1).filter(turn => turn.status === 'complete')
  const inScopeTurnIds = inScopeTurns.map(turn => turn.id)

  const allRounds = listRoundRecordsBySession(database.connection, targetSessionId)
  const allParts = listPartRecordsBySession(database.connection, targetSessionId)

  const partsByRound = new Map<string, typeof allParts>()
  for (const part of allParts) {
    if (!part.roundId) continue
    const existing = partsByRound.get(part.roundId)
    if (existing) {
      existing.push(part)
    } else {
      partsByRound.set(part.roundId, [part])
    }
  }

  const partsByTurn = new Map<string, typeof allParts>()
  for (const part of allParts) {
    if (!part.turnId) continue
    const existing = partsByTurn.get(part.turnId)
    if (existing) {
      existing.push(part)
    } else {
      partsByTurn.set(part.turnId, [part])
    }
  }

  const targetMcpInstructionsPartId = allParts.find(part => part.turnId === null && part.partType === 'mcp-instructions')?.id ?? null
  const targetToolDefinitionsPartId = allParts.find(part => part.turnId === null && part.partType === 'tool-definitions')?.id ?? null
  const inScopeTurnIdSet = new Set(inScopeTurnIds)
  const userMessageParts = allParts
    .filter(part => part.partType === 'user-message' && part.turnId && inScopeTurnIdSet.has(part.turnId))
    .sort((left, right) => left.ordinal - right.ordinal)
  const userRequestPartId = userMessageParts[0]?.id ?? null
  const finalAnswerPartId = allParts
    .filter(part => part.turnId === targetTurnId && part.partType === 'assistant-content')
    .sort((left, right) => left.ordinal - right.ordinal)
    .at(-1)?.id ?? null

  const packets: EvidencePacket[] = []
  const selectedToolNameSet = new Set(selectedToolNames)
  const inScopeRounds = allRounds.filter(round => inScopeTurnIds.includes(round.turnId))

  for (const round of inScopeRounds) {
    const roundParts = (partsByRound.get(round.id) ?? []).sort((left, right) => left.ordinal - right.ordinal)
    const turnParts = (partsByTurn.get(round.turnId) ?? []).sort((left, right) => left.ordinal - right.ordinal)
    const toolCallParts = roundParts.filter(part => part.partType === 'tool-call')
    const toolResultParts = turnParts.filter(part => part.partType === 'tool-result')
    const reasoningAndContentParts = turnParts
      .filter(part => part.partType === 'assistant-reasoning' || part.partType === 'assistant-content')
      .sort((left, right) => left.ordinal - right.ordinal)

    for (const toolCallPart of toolCallParts) {
      const toolCallJson = toolCallPart.payload.json as { name?: string; id?: string; arguments?: string } | null
      const toolName = toolCallJson?.name ?? 'unknown'
      const toolCallParameters = toolCallJson?.arguments ?? '{}'
      const toolResultPart = toolResultParts.find(toolResult => {
        const toolResultJson = toolResult.payload.json as { tool_call_id?: string } | null
        if (toolResultJson?.tool_call_id) {
          return toolResultJson.tool_call_id === toolCallJson?.id
        }
        return toolResult.roundId === round.id && toolResult.ordinal > toolCallPart.ordinal
      })

      const reasoningBeforePart = reasoningAndContentParts.findLast(part => part.ordinal < toolCallPart.ordinal) ?? null
      const afterOrdinal = toolResultPart ? toolResultPart.ordinal : toolCallPart.ordinal
      const reasoningAfterPart = reasoningAndContentParts.find(part => part.ordinal > afterOrdinal) ?? null
      const toolResultIsError = (toolResultPart?.provenanceJson as { isError?: boolean } | null)?.isError === true

      if (selectedToolNameSet.size > 0 && !selectedToolNameSet.has(toolName)) {
        continue
      }
      if (onlyFailedToolCalls && !toolResultIsError) {
        continue
      }

      packets.push({
        turn_id: round.turnId,
        round_id: round.id,
        tool_call_part_id: toolCallPart.id,
        tool_name: toolName,
        tool_call_parameters: toolCallParameters,
        reasoning_before_part_id: reasoningBeforePart?.id ?? null,
        tool_result_part_id: toolResultPart?.id ?? null,
        reasoning_after_part_id: reasoningAfterPart?.id ?? null,
      })
    }
  }

  return {
    analysisTarget: {
      target_session_id: targetSessionId,
      target_turn_id: targetTurnId,
      analysis_goal: analysisGoal,
      selected_tool_names: selectedToolNames,
      only_failed_tool_calls: onlyFailedToolCalls,
      evaluation_criteria: evaluationCriteria,
      analyzed_turn_ids: inScopeTurnIds,
      target_mcp_instructions_part_id: targetMcpInstructionsPartId,
      target_tool_definitions_part_id: targetToolDefinitionsPartId,
      user_request_part_id: userRequestPartId,
      final_answer_part_id: finalAnswerPartId,
    },
    packets,
    bootstrapInspectIds: [
      targetSessionId,
      ...(targetMcpInstructionsPartId ? [targetMcpInstructionsPartId] : []),
      ...(targetToolDefinitionsPartId ? [targetToolDefinitionsPartId] : []),
    ],
  }
}

export function buildFastToolWorkIndex(packets: EvidencePacket[]): FastToolWorkIndex {
  const groupsByTool = new Map<string, FastToolWorkGroup>()

  for (const packet of packets) {
    const existing = groupsByTool.get(packet.tool_name)
    if (!existing) {
      groupsByTool.set(packet.tool_name, {
        work_unit_id: `tool-group-${groupsByTool.size + 1}`,
        tool_name: packet.tool_name,
        tool_call_part_ids: [packet.tool_call_part_id],
        tool_result_part_ids: packet.tool_result_part_id ? [packet.tool_result_part_id] : [],
        reasoning_before_part_ids: packet.reasoning_before_part_id ? [packet.reasoning_before_part_id] : [],
        reasoning_after_part_ids: packet.reasoning_after_part_id ? [packet.reasoning_after_part_id] : [],
        turn_ids: [packet.turn_id],
        round_ids: [packet.round_id],
      })
      continue
    }

    pushUnique(existing.tool_call_part_ids, packet.tool_call_part_id)
    if (packet.tool_result_part_id) pushUnique(existing.tool_result_part_ids, packet.tool_result_part_id)
    if (packet.reasoning_before_part_id) pushUnique(existing.reasoning_before_part_ids, packet.reasoning_before_part_id)
    if (packet.reasoning_after_part_id) pushUnique(existing.reasoning_after_part_ids, packet.reasoning_after_part_id)
    pushUnique(existing.turn_ids, packet.turn_id)
    pushUnique(existing.round_ids, packet.round_id)
  }

  return { tool_groups: [...groupsByTool.values()] }
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value)
  }
}