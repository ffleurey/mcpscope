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
  assessmentSchemaKey: string
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
  const assessmentSchemaKey = input.assessmentSchemaKey

  // ── Load artifacts ────────────────────────────────────────────────────────
  const packetIndexArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
  )
  if (!packetIndexArtifact) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'coverage_validation',
        error_kind: 'missing_packet_index',
        message: 'evidence_packet_index artifact missing — bootstrap may not have completed',
        detail: {
          has_packet_index: packetIndexArtifact != null,
        },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: now(),
    })
    return { updatedState: { ...state, phase: 'error' }, passed: false }
  }

  const packetIndex = packetIndexArtifact.content as EvidencePacketIndex
  const assessments = listArtifactsBySessionAndSchemaKey(
    database.connection,
    analysisSessionId,
    assessmentSchemaKey,
  )
  const assessedToolCallPartIds = new Set(
    assessments.map(a => {
      const meta = a.metadata as { tool_call_part_id?: string }
      return meta.tool_call_part_id
    }),
  )

  // ── Validate every packet is covered ─────────────────────────────────────
  const unassessed = packetIndex.packets.filter(
    p => !assessedToolCallPartIds.has(p.tool_call_part_id),
  )

  const failures = unassessed.map(
    p => `Tool call ${p.tool_call_part_id} (${p.tool_name}) has no accepted assessment`,
  )

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
