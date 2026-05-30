/**
 * AnalysisContextMutationStep
 *
 * After each assessment LLM turn:
 *  1. Exclude the evidence inject part(s) written before the assessment so they
 *     are not carried into the next LLM call.
 *  2. Exclude the assessment turn's assistant-reasoning parts (keep the
 *     assistant-content JSON result in context for the final aggregation).
 *  3. Mark the assessment turn's user-message as 'historical-only' to prevent
 *     consecutive-assistant-message API errors on subsequent calls.
 *  4. Update the coverage_map artifact to record that the packet was assessed.
 */

import type { BackendDatabase } from '../persistence/db.js'
import {
  updatePartRecord,
  getPartRecord,
  listPartRecordsBySession,
} from '../persistence/repository.js'
import {
  getLatestArtifactBySchemaKey,
  updateJsonArtifact,
} from './artifactRepository.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type CoverageMap,
  type EvidencePacketIndex,
} from './schemas.js'

export interface ContextMutationInput {
  state: AnalysisSessionState
  assessmentArtifactId: string
}

export interface ContextMutationResult {
  updatedState: AnalysisSessionState
}

export function runContextMutationStep(
  database: BackendDatabase,
  input: ContextMutationInput,
): ContextMutationResult {
  const { state, assessmentArtifactId } = input
  const {
    analysisSessionId,
    pendingMutationTurnId,
    pendingInjectPartIds,
    pendingReasoningPartIds,
    nextPacketIndex,
  } = state

  const mutatedAt = Date.now()

  // ── 1. Exclude inject evidence parts ─────────────────────────────────────
  for (const partId of pendingInjectPartIds) {
    const part = getPartRecord(database.connection, partId)
    if (part) {
      updatePartRecord(database.connection, {
        ...part,
        context: {
          ...part.context,
          state: 'excluded',
          note: 'Evidence inject excluded after assessment completed',
        },
        updatedAt: mutatedAt,
      })
    }
  }

  // ── 2. Exclude assessment reasoning parts ─────────────────────────────────
  for (const partId of pendingReasoningPartIds) {
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
  if (pendingMutationTurnId) {
    const sessionParts = listPartRecordsBySession(database.connection, analysisSessionId)
    const userPart = sessionParts.find(
      p => p.turnId === pendingMutationTurnId && p.partType === 'user-message',
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

  // ── 4. Update coverage map ────────────────────────────────────────────────
  const completedPacketIndex = nextPacketIndex - 1 // we just finished this packet
  const coverageArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.COVERAGE_MAP,
  )
  if (coverageArtifact) {
    const coverageMap = coverageArtifact.content as CoverageMap
    const updatedEntries = coverageMap.entries.map(entry => {
      if (entry.packet_index === completedPacketIndex) {
        return {
          ...entry,
          assessed: true,
          assessment_artifact_id: assessmentArtifactId,
        }
      }
      return entry
    })
    updateJsonArtifact(
      database.connection,
      coverageArtifact.id,
      { entries: updatedEntries },
      coverageArtifact.metadata,
    )
  }

  // ── 5. Determine next phase based on turn boundaries ─────────────────────
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
  const isTurnComplete = !nextPacket || nextPacket.turn_id !== state.currentTurnId
  const nextPhase = isTurnComplete ? 'turn_summary' : 'assessing'

  const updatedState: AnalysisSessionState = {
    ...state,
    phase: nextPhase,
    awaitingContextMutation: false,
    pendingMutationTurnId: null,
    pendingInjectPartIds: [],
    pendingReasoningPartIds: [],
  }

  return { updatedState }
}
