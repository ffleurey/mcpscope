/**
 * AnalysisToolCallAssessmentTurn
 *
 * Runs one bounded LLM call to assess a single tool-call evidence packet.
 * Writes an accepted tool_call_assessment artifact on success, or a
 * diagnostic artifact on parse/validation failure.
 */

import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import {
  getPartRecord,
  getSessionRecord,
} from '../persistence/repository.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
  listArtifactsBySessionAndSchemaKey,
} from './artifactRepository.js'
import { runBoundedAnalysisTurn } from './boundedTurn.js'
import {
  SCHEMA_KEY,
  toolCallAssessmentSchema,
  type AnalysisSessionState,
  type EvidencePacket,
  type AnalysisTarget,
} from './schemas.js'
import type { ZodError } from 'zod'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export interface AssessmentTurnInput {
  state: AnalysisSessionState
  stepId: string
  packet: EvidencePacket
  analysisTarget: AnalysisTarget
}

export interface AssessmentTurnResult {
  updatedState: AnalysisSessionState
  /** ID of the written assessment artifact, or null on failure. */
  assessmentArtifactId: string | null
  success: boolean
  turnId: string
}

function formatPartContent(part: { payload: { text: string | null; json: unknown } } | null | undefined): string {
  if (!part) return '(not available)'
  if (part.payload.text) return part.payload.text
  if (part.payload.json != null) return JSON.stringify(part.payload.json, null, 2)
  return '(empty)'
}

export async function runToolCallAssessmentTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  input: AssessmentTurnInput,
): Promise<AssessmentTurnResult> {
  const { state, stepId, packet, analysisTarget } = input
  const { analysisSessionId } = state

  const analysisSession = getSessionRecord(database.connection, analysisSessionId)
  if (!analysisSession) {
    throw new Error(`Assessment turn: analysis session not found: ${analysisSessionId}`)
  }

  // ── Load packet evidence from parent session ──────────────────────────────
  const toolCallPart = getPartRecord(database.connection, packet.tool_call_part_id)
  const toolResultPart = packet.tool_result_part_id
    ? getPartRecord(database.connection, packet.tool_result_part_id)
    : null
  const reasoningBeforePart = packet.reasoning_before_part_id
    ? getPartRecord(database.connection, packet.reasoning_before_part_id)
    : null
  const reasoningAfterPart = packet.reasoning_after_part_id
    ? getPartRecord(database.connection, packet.reasoning_after_part_id)
    : null

  // ── Load prior accepted assessments (for context) ─────────────────────────
  const priorAssessments = listArtifactsBySessionAndSchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
  ).map(a => a.content)

  // ── Load user request text ────────────────────────────────────────────────
  const userRequestPart = analysisTarget.user_request_part_id
    ? getPartRecord(database.connection, analysisTarget.user_request_part_id)
    : null

  // ── Build assessment prompt ───────────────────────────────────────────────
  const systemMessage = buildSystemMessage(analysisTarget)
  const userMessage = buildUserMessage({
    analysisTarget,
    packet,
    userRequestPart,
    toolCallPart,
    toolResultPart,
    reasoningBeforePart,
    reasoningAfterPart,
    priorAssessments,
  })

  // ── Run bounded LLM call ──────────────────────────────────────────────────
  const turnResult = await runBoundedAnalysisTurn(
    database,
    lmGateway,
    {
      id: analysisSession.id,
      modelProfileSnapshot: {
        connectionBaseUrl: analysisSession.modelProfileSnapshot.connectionBaseUrl,
        modelKey: analysisSession.modelProfileSnapshot.modelKey,
        apiKey: analysisSession.modelProfileSnapshot.apiKey,
      },
    },
    [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ],
  )

  // ── Parse and validate the response ──────────────────────────────────────
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
        step_type: 'tool_call_assessment',
        error_kind: 'json_parse_error',
        message: 'LLM response was not valid JSON',
        detail: { raw_response: turnResult.responseText, error: String(e) },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC, packet_index: packet.packet_index },
      createdAt: ts,
    })
    const updatedState: AnalysisSessionState = {
      ...state,
      phase: 'error',
      awaitingContextMutation: false,
      pendingMutationTurnId: null,
    }
    return {
      updatedState,
      assessmentArtifactId: null,
      success: false,
      turnId: turnResult.turnId,
    }
  }

  const parsed = toolCallAssessmentSchema.safeParse(parsedJson)
  if (!parsed.success) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'tool_call_assessment',
        error_kind: 'schema_validation_error',
        message: 'LLM response did not match tool_call_assessment schema',
        detail: {
          raw_response: turnResult.responseText,
          errors: (parsed.error as ZodError).issues,
        },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC, packet_index: packet.packet_index },
      createdAt: ts,
    })
    const updatedState: AnalysisSessionState = {
      ...state,
      phase: 'error',
      awaitingContextMutation: false,
      pendingMutationTurnId: null,
    }
    return {
      updatedState,
      assessmentArtifactId: null,
      success: false,
      turnId: turnResult.turnId,
    }
  }

  // ── Write accepted assessment artifact ────────────────────────────────────
  const assessmentArtifactId = uuid()
  insertJsonArtifact(database.connection, {
    id: assessmentArtifactId,
    sessionId: analysisSessionId,
    stepId,
    content: parsed.data,
    metadata: {
      schema_key: SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
      packet_index: packet.packet_index,
      turn_id: packet.turn_id,
      round_id: packet.round_id,
      tool_call_part_id: packet.tool_call_part_id,
    },
    createdAt: ts,
  })

  const updatedState: AnalysisSessionState = {
    ...state,
    awaitingContextMutation: true,
    pendingMutationTurnId: turnResult.turnId,
  }

  return {
    updatedState,
    assessmentArtifactId,
    success: true,
    turnId: turnResult.turnId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemMessage(analysisTarget: AnalysisTarget): string {
  return `You are a precise analysis assistant. Your job is to assess individual tool calls made by an LLM during a session, given the conversation context and the specific analysis goal.

Analysis goal: ${analysisTarget.analysis_goal}

You will be given:
- The user's original request
- Prior assessments already completed
- Evidence for a single tool call (reasoning before, tool invocation, tool result, reasoning after)

You MUST respond with a single, valid JSON object that exactly matches the required schema. Do not include any prose, markdown, or explanation outside the JSON object.`
}

interface UserMessageInput {
  analysisTarget: AnalysisTarget
  packet: EvidencePacket
  userRequestPart: { payload: { text: string | null; json: unknown } } | null | undefined
  toolCallPart: { payload: { text: string | null; json: unknown } } | null | undefined
  toolResultPart: { payload: { text: string | null; json: unknown } } | null | undefined
  reasoningBeforePart: { payload: { text: string | null; json: unknown } } | null | undefined
  reasoningAfterPart: { payload: { text: string | null; json: unknown } } | null | undefined
  priorAssessments: unknown[]
}

function buildUserMessage(input: UserMessageInput): string {
  const {
    packet,
    userRequestPart,
    toolCallPart,
    toolResultPart,
    reasoningBeforePart,
    reasoningAfterPart,
    priorAssessments,
  } = input

  const priorSection =
    priorAssessments.length === 0
      ? '(none yet)'
      : JSON.stringify(priorAssessments, null, 2)

  return `=== USER REQUEST ===
${formatPartContent(userRequestPart)}

=== TOOL CALL TO ASSESS (packet ${packet.packet_index + 1}) ===
Turn: ${packet.turn_id}
Round: ${packet.round_id}
Tool: ${packet.tool_name}

[Reasoning before call]
${formatPartContent(reasoningBeforePart)}

[Tool call]
${formatPartContent(toolCallPart)}

[Tool result]
${formatPartContent(toolResultPart)}

[Reasoning after result]
${formatPartContent(reasoningAfterPart)}

=== PRIOR ACCEPTED ASSESSMENTS ===
${priorSection}

=== REQUIRED OUTPUT ===
Return exactly one JSON object with this shape (no prose, just JSON):
{
  "packet_index": ${packet.packet_index},
  "turn_id": "${packet.turn_id}",
  "round_id": "${packet.round_id}",
  "tool_name": "${packet.tool_name}",
  "expectation_match": "match" | "partial_match" | "mismatch" | "unclear",
  "expectation_rationale": "<one or two sentences>",
  "most_direct_cause": "wrong_parameters" | "tool_misunderstanding" | "tool_description_clarity" | "tool_surface_mismatch" | "tool_limitation" | "unclear" | null,
  "result_usage_quality": "good" | "partial" | "poor" | "not_applicable" | "unclear",
  "result_usage_rationale": "<one or two sentences>",
  "notable_observations": "<optional string>"
}`
}

/**
 * Extract the first JSON block from a response string.
 * Handles both bare JSON objects and ```json...``` fenced blocks.
 */
function extractJsonBlock(text: string): string {
  const trimmed = text.trim()

  // Try fenced code block
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced?.[1]) return fenced[1].trim()

  // Find first { and last } for a bare JSON object
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1)
  }

  return trimmed
}

// Re-export for use in coverage validation
export { getLatestArtifactBySchemaKey }
