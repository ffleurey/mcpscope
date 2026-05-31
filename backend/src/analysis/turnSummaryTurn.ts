/**
 * TurnSummaryTurn
 *
 * After all tool calls in a target-session turn have been assessed, runs one
 * bounded LLM call to produce a turn-level summary of findings.
 *
 * The accumulated context at this point contains:
 *   - system-prompt (analysis persona)
 *   - mcp-instructions (full tool context from target session)
 *   - turn-context inject (user request, answer, part structure)
 *   - all per-tool assessment results (assistant-content JSON parts)
 *
 * After the summary is written the turn-context inject part is excluded from
 * context, freeing space before the next turn (or coverage validation).
 */

import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import {
  getSessionRecord,
} from '../persistence/repository.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
} from './artifactRepository.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { runAnalysisTurn } from './boundedTurn.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import {
  SCHEMA_KEY,
  turnSummarySchema,
  type AnalysisSessionState,
  type EvidencePacketIndex,
} from './schemas.js'
import type { ZodError } from 'zod'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

function extractJsonBlock(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

export interface TurnSummaryInput {
  state: AnalysisSessionState
  stepId: string
}

export interface TurnSummaryResult {
  updatedState: AnalysisSessionState
  summaryArtifactId: string | null
  success: boolean
}

export async function runTurnSummaryTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  input: TurnSummaryInput,
  emitEvent?: AnalysisStreamEventSink,
): Promise<TurnSummaryResult> {
  const { state, stepId } = input
  const { analysisSessionId, currentTurnId } = state

  if (!currentTurnId) {
    throw new Error('TurnSummaryTurn: currentTurnId is null — cannot summarise')
  }

  const analysisSession = getSessionRecord(database.connection, analysisSessionId)
  if (!analysisSession) {
    throw new Error(`TurnSummaryTurn: analysis session not found: ${analysisSessionId}`)
  }

  // ── Load this turn's assessments ──────────────────────────────────────────
  // Assessments for all packets with the current turn_id.
  const packetIndexArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.EVIDENCE_PACKET_INDEX,
  )
  const packetIndex = packetIndexArtifact?.content as EvidencePacketIndex | undefined
  const turnPackets = packetIndex?.packets.filter(p => p.turn_id === currentTurnId) ?? []

  // ── Build summary question ────────────────────────────────────────────────
  // The accumulated context already contains the turn context inject and all
  // assessment result parts for this turn.
  const summaryQuestion = `You have just completed assessing ${turnPackets.length} tool call(s) for turn ${currentTurnId}. The individual assessment results are in the context above.

Synthesize a turn-level summary of your findings.

Return exactly one JSON object with this shape (no prose, just JSON):
{
  "turn_id": "${currentTurnId}",
  "total_tool_calls_assessed": ${turnPackets.length},
  "turn_outcome": "successful" | "partially_successful" | "failed" | "unclear",
  "turn_outcome_rationale": "<2-3 sentences explaining the overall tool usage quality>",
  "per_tool_findings": [
    {
      "packet_index": <number>,
      "tool_name": "<name>",
      "expectation_match": "match" | "partial_match" | "mismatch" | "unclear",
      "brief_finding": "<one sentence>"
    }
  ],
  "notable_observations": "<optional string or null>"
}`

  // ── Run context-aware LLM turn ────────────────────────────────────────────
  const turnResult = await runAnalysisTurn(
    database,
    lmGateway,
    mcpGateway,
    analysisSessionId,
    summaryQuestion,
    emitEvent,
  )

  // ── Parse and validate ────────────────────────────────────────────────────
  const ts = now()
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(extractJsonBlock(turnResult.responseText))
  } catch (e) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'turn_summary',
        error_kind: 'json_parse_error',
        message: 'Turn summary LLM response was not valid JSON',
        detail: { raw_response: turnResult.responseText, error: String(e), turn_id: currentTurnId },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return {
      updatedState: { ...state, phase: 'error' },
      summaryArtifactId: null,
      success: false,
    }
  }

  const parsed = turnSummarySchema.safeParse(parsedJson)
  if (!parsed.success) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'turn_summary',
        error_kind: 'schema_validation_error',
        message: 'Turn summary response did not match turn_summary schema',
        detail: {
          raw_response: turnResult.responseText,
          errors: (parsed.error as ZodError).issues,
          turn_id: currentTurnId,
        },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC },
      createdAt: ts,
    })
    return {
      updatedState: { ...state, phase: 'error' },
      summaryArtifactId: null,
      success: false,
    }
  }

  // ── Write turn summary artifact ───────────────────────────────────────────
  const summaryArtifactId = uuid()
  insertJsonArtifact(database.connection, {
    id: summaryArtifactId,
    sessionId: analysisSessionId,
    stepId,
    content: parsed.data,
    metadata: {
      schema_key: SCHEMA_KEY.TURN_SUMMARY,
      turn_id: currentTurnId,
      total_assessed: turnPackets.length,
    },
    createdAt: ts,
  })

  // ── Determine next phase ──────────────────────────────────────────────────
  // If there are more packets (in subsequent turns), continue assessing.
  // Otherwise go to coverage_validation.
  const hasMorePackets = state.nextPacketIndex < state.packetCount
  const nextPhase = hasMorePackets ? 'assessing' : 'coverage_validation'

  const updatedState: AnalysisSessionState = {
    ...state,
    phase: nextPhase,
    currentTurnId: null,
  }

  return { updatedState, summaryArtifactId, success: true }
}
