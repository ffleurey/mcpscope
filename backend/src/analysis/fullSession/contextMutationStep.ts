/**
 * AnalysisContextMutationStep
 *
 * After each assessment LLM turn:
 *  1. Exclude the deterministic inspect prompt/tool/result parts written before
 *     the assessment so they are not carried into the next LLM call.
 *  2. Exclude the assessment turn's assistant-reasoning parts (keep the
 *     assistant-content JSON result in context for the final aggregation).
 *  3. Mark the assessment turn's user-message as 'historical-only' to prevent
 *     consecutive-assistant-message API errors on subsequent calls.
 *  4. Determine the next phase from packet index state.
 */

import type { BackendDatabase } from '../../persistence/db.js'
import {
  updatePartRecord,
  getPartRecord,
  listPartRecordsBySession,
} from '../../persistence/repository.js'
import {
  getLatestArtifactBySchemaKey,
} from '../artifactRepository.js'
import {
  SCHEMA_KEY,
  type EvidencePacketIndex,
} from '../schemas.js'

export interface ContextMutationInput {
  analysisSessionId: string
  currentTurnId: string
  nextPacketIndex: number
  injectPartIds: string[]
  reasoningPartIds: string[]
  userTurnId: string | null
}

export interface ContextMutationResult {
  nextPhase: 'assessing' | 'turn_summary'
}

export function runContextMutationStep(
  database: BackendDatabase,
  input: ContextMutationInput,
): ContextMutationResult {
  const {
    analysisSessionId,
    currentTurnId,
    nextPacketIndex,
    injectPartIds,
    reasoningPartIds,
    userTurnId,
  } = input

  const mutatedAt = Date.now()

  // ── 1. Exclude deterministic inspect evidence parts ─────────────────────
  for (const partId of injectPartIds) {
    const part = getPartRecord(database.connection, partId)
    if (part) {
      updatePartRecord(database.connection, {
        ...part,
        context: {
          ...part.context,
          state: 'excluded',
          note: 'Deterministic inspect evidence excluded after assessment completed',
        },
        updatedAt: mutatedAt,
      })
    }
  }

  // ── 2. Exclude assessment reasoning parts ─────────────────────────────────
  for (const partId of reasoningPartIds) {
    const part = getPartRecord(database.connection, partId)
    if (part) {
      updatePartRecord(database.connection, {
        ...part,
        context: {
          ...part.context,
          state: 'excluded',
          note: 'Assessment reasoning excluded after assessment completed (keeping assistant-content)',
        },
        updatedAt: mutatedAt,
      })
    }
  }

  // ── 3. Mark assessment turn user-message as historical-only ───────────────
  if (userTurnId) {
    const sessionParts = listPartRecordsBySession(database.connection, analysisSessionId)
    const userPart = sessionParts.find(
      p => p.turnId === userTurnId && p.partType === 'user-message',
    )
    if (userPart) {
      updatePartRecord(database.connection, {
        ...userPart,
        context: {
          ...userPart.context,
          state: 'historical-only',
          note: 'Assessment question excluded from active context after assessment completed',
        },
        updatedAt: mutatedAt,
      })
    }
  }

  // ── 4. Determine next phase based on turn boundaries ─────────────────────
  // Load packet index to check what turn the next packet belongs to.
  const nextIdx = nextPacketIndex
  const packetIndexArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
  )
  const packetIndex = packetIndexArtifact?.content as EvidencePacketIndex | undefined
  const nextPacket = packetIndex?.packets[nextIdx]

  // Determine next phase:
  // - If no more packets, or next packet is in a different turn → turn_summary
  // - If next packet is in the same turn → stay in assessing
  const isTurnComplete = !nextPacket || nextPacket.turn_id !== currentTurnId
  const nextPhase = isTurnComplete ? 'turn_summary' : 'assessing'

  return { nextPhase }
}
