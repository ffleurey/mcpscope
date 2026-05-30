/**
 * AnalysisBootstrapStep
 *
 * Reads the target session, builds the evidence packet index, and writes three
 * analysis artifacts:
 *   - analysis_target  (summary of what is being analyzed)
 *   - evidence_packet_index  (ordered list of tool-call packets)
 *   - coverage_map  (tracking which packets have been assessed)
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
  type CoverageMap,
  type AnalysisSessionState,
} from './schemas.js'

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
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const { state, stepId } = input
  const { targetSessionId, targetTurnId, analysisSessionId, analysisGoal } = state

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

  // ── 4. Find user request + final answer parts ─────────────────────────────
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
  let packetIndex = 0

  // Rounds in scope are those whose turnId is in inScopeTurnIds
  const inScopeRounds = allRounds.filter(r => inScopeTurnIds.includes(r.turnId))

  for (const round of inScopeRounds) {
    const roundParts = (partsByRound.get(round.id) ?? []).sort((a, b) => a.ordinal - b.ordinal)
    const toolCallParts = roundParts.filter(p => p.partType === 'tool-call')
    const toolResultParts = roundParts.filter(p => p.partType === 'tool-result')
    const reasoningParts = roundParts.filter(p => p.partType === 'assistant-reasoning')
    const contentParts = roundParts.filter(p => p.partType === 'assistant-content')

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
        // Fall back: use first unmatched result
        return true
      })

      // Reasoning before: last assistant-reasoning or content part before this tool call
      const reasoningBeforePart = [...reasoningParts, ...contentParts]
        .sort((a, b) => a.ordinal - b.ordinal)
        .findLast(p => p.ordinal < toolCallPart.ordinal) ?? null

      // Reasoning after: first reasoning/content part after the tool result
      const afterOrdinal = toolResultPart ? toolResultPart.ordinal : toolCallPart.ordinal
      const reasoningAfterPart = [...reasoningParts, ...contentParts]
        .sort((a, b) => a.ordinal - b.ordinal)
        .find(p => p.ordinal > afterOrdinal) ?? null

      packets.push({
        packet_index: packetIndex++,
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
    analyzed_turn_ids: inScopeTurnIds,
    user_request_part_id: userRequestPartId,
    final_answer_part_id: finalAnswerPartId,
  }

  const evidencePacketIndex: EvidencePacketIndex = { packets }

  const coverageMap: CoverageMap = {
    entries: packets.map(p => ({
      packet_index: p.packet_index,
      tool_call_part_id: p.tool_call_part_id,
      assessment_artifact_id: null,
      assessed: false,
    })),
  }

  const targetArtifactId = uuid()
  const packetIndexArtifactId = uuid()
  const coverageMapArtifactId = uuid()

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
    insertJsonArtifact(database.connection, {
      id: coverageMapArtifactId,
      sessionId: analysisSessionId,
      stepId,
      content: coverageMap,
      metadata: {
        schema_key: SCHEMA_KEY.COVERAGE_MAP,
        target_artifact_id: targetArtifactId,
        packet_index_artifact_id: packetIndexArtifactId,
      },
      createdAt: ts,
    })
  })()

  // Mark bootstrap as complete, seed packet counts
  const updatedState: AnalysisSessionState = {
    ...state,
    phase: packets.length > 0 ? 'assessing' : 'coverage_validation',
    bootstrapComplete: true,
    packetCount: packets.length,
    nextPacketIndex: 0,
    awaitingContextMutation: false,
    pendingMutationTurnId: null,
  }

  return { updatedState, packetCount: packets.length }
}
