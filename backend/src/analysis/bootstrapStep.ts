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
} from '../persistence/repository.js'
import {
  insertJsonArtifact,
} from './artifactRepository.js'
import {
  SCHEMA_KEY,
  type EvidencePacketIndex,
  type AnalysisSessionState,
} from './schemas.js'
import { collectAnalysisPlanningData } from './analysisPlanning.js'
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
  const { analysisTarget, packets, bootstrapInspectIds } = collectAnalysisPlanningData(database, state)
  const { analysisSessionId } = state

  // ── 6. Write artifacts ────────────────────────────────────────────────────
  const ts = now()

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

  await runDeterministicMcpToolCallsInSingleTurn(
    database,
    mcpGateway,
    analysisSession,
    bootstrapInspectIds.map(id => ({ toolName: 'mcpscope_inspect', toolArgs: { id } })),
    emitEvent,
    input.stepId,
  )

  // ── 7. Mark bootstrap as complete, seed packet counts ───────────────────
  const updatedState: AnalysisSessionState = {
    ...state,
    phase: packets.length > 0 ? 'assessing' : 'coverage_validation',
    bootstrapComplete: true,
    packetCount: packets.length,
    nextPacketIndex: 0,
    currentTurnId: null,
  }

  return { updatedState, packetCount: packets.length }
}
