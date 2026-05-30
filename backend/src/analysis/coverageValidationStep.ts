/**
 * AnalysisCoverageValidationStep
 *
 * Verifies that every packet in the evidence_packet_index has an accepted
 * tool_call_assessment artifact. On failure, writes a diagnostic artifact and
 * sets the session phase to 'error'. On success, advances to 'final_aggregation'.
 */

import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
  listArtifactsBySessionAndSchemaKey,
} from './artifactRepository.js'
import {
  SCHEMA_KEY,
  type AnalysisSessionState,
  type EvidencePacketIndex,
  type CoverageMap,
} from './schemas.js'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export interface CoverageValidationInput {
  state: AnalysisSessionState
  stepId: string
}

export interface CoverageValidationResult {
  updatedState: AnalysisSessionState
  passed: boolean
}

export function runCoverageValidationStep(
  database: BackendDatabase,
  input: CoverageValidationInput,
): CoverageValidationResult {
  const { state, stepId } = input
  const { analysisSessionId } = state

  // ── Load artifacts ────────────────────────────────────────────────────────
  const packetIndexArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
  )
  const coverageArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.COVERAGE_MAP,
  )

  if (!packetIndexArtifact || !coverageArtifact) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'coverage_validation',
        error_kind: 'missing_bootstrap_artifacts',
        message: 'evidence_packet_index or coverage_map artifact missing — bootstrap may not have completed',
        detail: {
          has_packet_index: packetIndexArtifact != null,
          has_coverage_map: coverageArtifact != null,
        },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: now(),
    })
    return { updatedState: { ...state, phase: 'error' }, passed: false }
  }

  const packetIndex = packetIndexArtifact.content as EvidencePacketIndex
  const coverageMap = coverageArtifact.content as CoverageMap
  const assessments = listArtifactsBySessionAndSchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
  )
  const assessedPacketIndices = new Set(
    assessments.map(a => {
      const meta = a.metadata as { packet_index?: number }
      return meta.packet_index
    }),
  )

  // ── Validate every packet is covered ─────────────────────────────────────
  const unassessed = packetIndex.packets.filter(
    p => !assessedPacketIndices.has(p.packet_index),
  )

  const unassessedFromMap = coverageMap.entries.filter(e => !e.assessed)

  const failures = [
    ...unassessed.map(p => `Packet ${p.packet_index} (${p.tool_name}) has no accepted assessment`),
    ...unassessedFromMap.filter(e => !unassessed.some(u => u.packet_index === e.packet_index)).map(e => `Coverage map entry ${e.packet_index} is not marked assessed`),
  ]

  if (failures.length > 0) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'coverage_validation',
        error_kind: 'incomplete_coverage',
        message: `${failures.length} packet(s) lack accepted assessments`,
        detail: { failures },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: now(),
    })
    return { updatedState: { ...state, phase: 'error' }, passed: false }
  }

  return {
    updatedState: {
      ...state,
      phase: 'final_aggregation',
      coverageValidated: true,
    },
    passed: true,
  }
}
