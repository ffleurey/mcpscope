/**
 * AnalysisContextMutationStep
 *
 * After each assessment LLM turn, mark the user-message part of that turn as
 * 'historical-only' so it is excluded from subsequent LLM calls (preventing
 * consecutive-assistant-message API errors), and update the coverage_map
 * artifact to record that the packet has been assessed.
 */

import type { BackendDatabase } from '../persistence/db.js'
import {
  updatePartRecord,
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
  const { analysisSessionId, pendingMutationTurnId, nextPacketIndex, packetCount } = state

  // ── 1. Mark user-message part as historical-only ──────────────────────────
  if (pendingMutationTurnId) {
    const sessionParts = listPartRecordsBySession(database.connection, analysisSessionId)
    const userPart = sessionParts.find(
      p => p.turnId === pendingMutationTurnId && p.partType === 'user-message',
    )
    if (userPart) {
      const updated = {
        ...userPart,
        context: {
          ...userPart.context,
          state: 'historical-only' as const,
          note: 'Analysis assessment prompt stripped from active context after assessment completed',
        },
        updatedAt: Date.now(),
      }
      updatePartRecord(database.connection, updated)
    }
  }

  // ── 2. Update coverage map ────────────────────────────────────────────────
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

  // ── 3. Advance state ──────────────────────────────────────────────────────
  const nextIdx = nextPacketIndex // nextPacketIndex was already incremented before mutation
  const isLastPacket = nextIdx >= packetCount

  const updatedState: AnalysisSessionState = {
    ...state,
    phase: isLastPacket ? 'coverage_validation' : 'assessing',
    awaitingContextMutation: false,
    pendingMutationTurnId: null,
  }

  return { updatedState }
}
