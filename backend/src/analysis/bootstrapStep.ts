/**
 * AnalysisBootstrapStep
 *
 * Reads the target session, builds the evidence packet index, and writes three
 * analysis artifacts:
 *   - analysis_target  (summary of what is being analyzed)
 *   - evidence_packet_index  (ordered list of tool-call packets)
 *
 * After this step completes, the analysis state transitions so the session
 * can begin assessing packets one by one.
 */

import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import {
  getSessionRecord,
  getTurnRecord,
  listTurnRecordsBySession,
  listRoundRecordsBySession,
  listPartRecordsBySession,
} from '../persistence/repository.js'
import {
  insertJsonArtifact,
} from './artifactRepository.js'
import {
  SCHEMA_KEY,
  type AnalysisTarget,
  type EvidencePacket,
  type EvidencePacketIndex,
  type AnalysisSessionState,
} from './schemas.js'
import {
  runDeterministicMcpToolCallsInSingleTurn,
  type McpGateway,
} from '../runtime/toolTurns.js'
import type { TurnStreamEventSink } from '../runtime/streamEvents.js'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export interface BootstrapInput {
  state: AnalysisSessionState
  stepId: string
}

export interface BootstrapResult {
  updatedState: AnalysisSessionState
  packetCount: number
}

export async function runBootstrapStep(
  database: BackendDatabase,
  mcpGateway: McpGateway,
  input: BootstrapInput,
  emitEvent?: TurnStreamEventSink,
): Promise<BootstrapResult> {
  const { state, stepId } = input
  const {
    targetSessionId,
    targetTurnId,
    analysisSessionId,
    analysisGoal,
    selectedToolNames,
    onlyFailedToolCalls,
    evaluationCriteria,
  } = state

  // ── 1. Validate target session + turn ──────────────────────────────────────
  const targetSession = getSessionRecord(database.connection, targetSessionId)
  if (!targetSession) {
    throw new Error(`Bootstrap: target session not found: ${targetSessionId}`)
  }

  const targetTurn = getTurnRecord(database.connection, targetTurnId)
  if (!targetTurn) {
    throw new Error(`Bootstrap: target turn not found: ${targetTurnId}`)
  }
  if (targetTurn.status !== 'complete') {
    throw new Error(
      `Bootstrap: target turn ${targetTurnId} is not complete (status: ${targetTurn.status})`,
    )
  }

  // ── 2. Determine in-scope turns (all complete turns up to and including target) ──
  const allTurns = listTurnRecordsBySession(database.connection, targetSessionId)
  const targetTurnIndex = allTurns.findIndex(t => t.id === targetTurnId)
  if (targetTurnIndex === -1) {
    throw new Error(`Bootstrap: target turn ${targetTurnId} not found in session ${targetSessionId}`)
  }
  const inScopeTurns = allTurns.slice(0, targetTurnIndex + 1).filter(t => t.status === 'complete')
  const inScopeTurnIds = inScopeTurns.map(t => t.id)

  // ── 3. Load rounds and parts for the target session ───────────────────────
  const allRounds = listRoundRecordsBySession(database.connection, targetSessionId)
  const allParts = listPartRecordsBySession(database.connection, targetSessionId)

  // Index parts by roundId
  const partsByRound = new Map<string, typeof allParts>()
  for (const part of allParts) {
    if (part.roundId) {
      const existing = partsByRound.get(part.roundId)
      if (existing) {
        existing.push(part)
      } else {
        partsByRound.set(part.roundId, [part])
      }
    }
  }

  const partsByTurn = new Map<string, typeof allParts>()
  for (const part of allParts) {
    if (part.turnId) {
      const existing = partsByTurn.get(part.turnId)
      if (existing) {
        existing.push(part)
      } else {
        partsByTurn.set(part.turnId, [part])
      }
    }
  }

  // ── 4. Find user request + final answer parts ─────────────────────────────
  const targetMcpInstructionsPartId = allParts
    .find(p => p.turnId === null && p.partType === 'mcp-instructions')?.id ?? null
  const targetToolDefinitionsPartId = allParts
    .find(p => p.turnId === null && p.partType === 'tool-definitions')?.id ?? null

  // User request: first user-message in the first in-scope turn
  const inScopeTurnIdSet = new Set(inScopeTurnIds)
  const userMessageParts = allParts
    .filter(p => p.partType === 'user-message' && p.turnId && inScopeTurnIdSet.has(p.turnId))
    .sort((a, b) => a.ordinal - b.ordinal)
  const userRequestPartId = userMessageParts[0]?.id ?? null

  // Final answer: last assistant-content in the target turn
  const targetTurnParts = allParts
    .filter(p => p.turnId === targetTurnId)
    .sort((a, b) => a.ordinal - b.ordinal)
  const finalAnswerParts = targetTurnParts.filter(p => p.partType === 'assistant-content')
  const finalAnswerPartId = finalAnswerParts[finalAnswerParts.length - 1]?.id ?? null

  // ── 5. Build evidence packets (one per tool-call part in scope) ───────────
  const packets: EvidencePacket[] = []
  const selectedToolNameSet = new Set(selectedToolNames)

  // Rounds in scope are those whose turnId is in inScopeTurnIds
  const inScopeRounds = allRounds.filter(r => inScopeTurnIds.includes(r.turnId))

  for (const round of inScopeRounds) {
    const roundParts = (partsByRound.get(round.id) ?? []).sort((a, b) => a.ordinal - b.ordinal)
    const turnParts = (partsByTurn.get(round.turnId) ?? []).sort((a, b) => a.ordinal - b.ordinal)
    const toolCallParts = roundParts.filter(p => p.partType === 'tool-call')
    const toolResultParts = turnParts.filter(p => p.partType === 'tool-result')
    const reasoningAndContentParts = turnParts
      .filter(p => p.partType === 'assistant-reasoning' || p.partType === 'assistant-content')
      .sort((a, b) => a.ordinal - b.ordinal)

    for (const toolCallPart of toolCallParts) {
      // Extract tool name from part payload JSON
      const toolCallJson = toolCallPart.payload.json as { name?: string } | null
      const toolName = toolCallJson?.name ?? 'unknown'

      // Find the tool result part for this tool call (match by parent or adjacent)
      // Tool-result parts reference their originating tool-call via payload.json.tool_call_id
      // or are simply co-located in the same round.
      const toolResultPart = toolResultParts.find(tr => {
        const trJson = tr.payload.json as { tool_call_id?: string } | null
        if (trJson?.tool_call_id) {
          const tcJson = toolCallPart.payload.json as { id?: string } | null
          return trJson.tool_call_id === tcJson?.id
        }
        return tr.roundId === round.id && tr.ordinal > toolCallPart.ordinal
      })

      // Reasoning before: last reasoning/content part earlier in the turn.
      const reasoningBeforePart = reasoningAndContentParts
        .findLast(p => p.ordinal < toolCallPart.ordinal) ?? null

      // Reasoning after: first reasoning/content part later in the turn, which may
      // live in the next round rather than the tool-call round itself.
      const afterOrdinal = toolResultPart ? toolResultPart.ordinal : toolCallPart.ordinal
      const reasoningAfterPart = reasoningAndContentParts
        .find(p => p.ordinal > afterOrdinal) ?? null

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
        reasoning_before_part_id: reasoningBeforePart?.id ?? null,
        tool_result_part_id: toolResultPart?.id ?? null,
        reasoning_after_part_id: reasoningAfterPart?.id ?? null,
      })
    }
  }

  // ── 6. Write artifacts ────────────────────────────────────────────────────
  const ts = now()

  const analysisTarget: AnalysisTarget = {
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
  }

  const evidencePacketIndex: EvidencePacketIndex = { packets }

  const targetArtifactId = uuid()
  const packetIndexArtifactId = uuid()

  database.connection.transaction(() => {
    insertJsonArtifact(database.connection, {
      id: targetArtifactId,
      sessionId: analysisSessionId,
      stepId,
      content: analysisTarget,
      metadata: { schema_key: SCHEMA_KEY.ANALYSIS_TARGET },
      createdAt: ts,
    })
    insertJsonArtifact(database.connection, {
      id: packetIndexArtifactId,
      sessionId: analysisSessionId,
      stepId,
      content: evidencePacketIndex,
      metadata: { schema_key: SCHEMA_KEY.EVIDENCE_PACKET_INDEX },
      createdAt: ts,
    })
  })()

  const analysisSession = getSessionRecord(database.connection, analysisSessionId)
  if (!analysisSession) {
    throw new Error(`Bootstrap: analysis session not found: ${analysisSessionId}`)
  }

  const bootstrapInspectCalls: Array<{ toolName: string; toolArgs: Record<string, unknown> }> = [
    { toolName: 'mcpscope_inspect', toolArgs: { id: targetSessionId } },
  ]

  if (targetMcpInstructionsPartId) {
    bootstrapInspectCalls.push({ toolName: 'mcpscope_inspect', toolArgs: { id: targetMcpInstructionsPartId } })
  }

  if (targetToolDefinitionsPartId) {
    bootstrapInspectCalls.push({ toolName: 'mcpscope_inspect', toolArgs: { id: targetToolDefinitionsPartId } })
  }

  await runDeterministicMcpToolCallsInSingleTurn(
    database,
    mcpGateway,
    analysisSession,
    bootstrapInspectCalls,
    emitEvent,
  )

  // ── 7. Mark bootstrap as complete, seed packet counts ───────────────────
  const updatedState: AnalysisSessionState = {
    ...state,
    phase: packets.length > 0 ? 'assessing' : 'coverage_validation',
    bootstrapComplete: true,
    packetCount: packets.length,
    nextPacketIndex: 0,
    awaitingContextMutation: false,
    pendingMutationTurnId: null,
    currentTurnId: null,
  }

  return { updatedState, packetCount: packets.length }
}
