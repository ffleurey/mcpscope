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
  getSessionRecord,
} from '../persistence/repository.js'
import {
  insertJsonArtifact,
} from './artifactRepository.js'
import {
  runDeterministicMcpToolCallsInSingleTurn,
  type McpGateway,
} from '../runtime/toolTurns.js'
import { runAnalysisTurn } from './boundedTurn.js'
import {
  buildAnalysisFocusInstructions,
  SCHEMA_KEY,
  toolCallAssessmentSchema,
  type AnalysisSessionState,
  type EvidencePacket,
  type AnalysisTarget,
} from './schemas.js'
import type { ZodError } from 'zod'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'

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

interface AssessmentIdentityValidation {
  valid: boolean
  failures: string[]
}

function validateAssessmentIdentity(packet: EvidencePacket, parsed: {
  turn_id: string
  round_id: string
  tool_call_part_id: string
  tool_name: string
}): AssessmentIdentityValidation {
  const failures: string[] = []

  if (parsed.turn_id !== packet.turn_id) {
    failures.push(`turn_id mismatch: expected ${packet.turn_id}, got ${parsed.turn_id}`)
  }
  if (parsed.round_id !== packet.round_id) {
    failures.push(`round_id mismatch: expected ${packet.round_id}, got ${parsed.round_id}`)
  }
  if (parsed.tool_call_part_id !== packet.tool_call_part_id) {
    failures.push(`tool_call_part_id mismatch: expected ${packet.tool_call_part_id}, got ${parsed.tool_call_part_id}`)
  }
  if (parsed.tool_name !== packet.tool_name) {
    failures.push(`tool_name mismatch: expected ${packet.tool_name}, got ${parsed.tool_name}`)
  }

  return {
    valid: failures.length === 0,
    failures,
  }
}

export async function runToolCallAssessmentTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  input: AssessmentTurnInput,
  emitEvent?: AnalysisStreamEventSink,
): Promise<AssessmentTurnResult> {
  const { state, stepId, packet, analysisTarget } = input
  const { analysisSessionId } = state

  const analysisSession = getSessionRecord(database.connection, analysisSessionId)
  if (!analysisSession) {
    throw new Error(`Assessment turn: analysis session not found: ${analysisSessionId}`)
  }

  // ── Load packet evidence through one deterministic inspect turn ──────────
  // Evidence is materialized as a single deterministic turn with multiple inspect
  // rounds so the step does not explode into one turn per inspected part.
  const injectPartIds: string[] = []

  // Packet-local evidence only: reasoning before, the tool call itself (which exposes
  // the attached result on direct inspect), and reasoning after.
  const evidencePartIds: string[] = [
    packet.reasoning_before_part_id,
    packet.tool_call_part_id,
    packet.reasoning_after_part_id,
  ].filter((id): id is string => id !== null)

  const { toolCallPartIds, toolResultPartIds } = await runDeterministicMcpToolCallsInSingleTurn(
    database,
    mcpGateway,
    analysisSession,
    evidencePartIds.map(partId => ({
      toolName: 'mcpscope_inspect',
      toolArgs: { id: partId },
    })),
    emitEvent,
  )
  injectPartIds.push(...toolCallPartIds, ...toolResultPartIds)

  // ── Assessment question ───────────────────────────────────────────────────
  const assessmentQuestion = buildAssessmentQuestion(packet, analysisTarget)

  // ── Run context-aware LLM turn ────────────────────────────────────────────
  const turnResult = await runAnalysisTurn(
    database,
    lmGateway,
    mcpGateway,
    analysisSessionId,
    assessmentQuestion,
    emitEvent,
  )

  // ── Parse and validate the response ──────────────────────────────────────
  const parseTs = now()
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
      metadata: {
        schema_key: SCHEMA_KEY.DIAGNOSTIC,
        tool_call_part_id: packet.tool_call_part_id,
        turn_id: packet.turn_id,
        round_id: packet.round_id,
      },
      createdAt: parseTs,
    })
    const updatedState: AnalysisSessionState = {
      ...state,
      phase: 'error',
      awaitingContextMutation: false,
      pendingMutationTurnId: null,
      pendingInjectPartIds: [],
      pendingReasoningPartIds: [],
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
      metadata: {
        schema_key: SCHEMA_KEY.DIAGNOSTIC,
        tool_call_part_id: packet.tool_call_part_id,
        turn_id: packet.turn_id,
        round_id: packet.round_id,
      },
      createdAt: parseTs,
    })
    const updatedState: AnalysisSessionState = {
      ...state,
      phase: 'error',
      awaitingContextMutation: false,
      pendingMutationTurnId: null,
      pendingInjectPartIds: [],
      pendingReasoningPartIds: [],
    }
    return {
      updatedState,
      assessmentArtifactId: null,
      success: false,
      turnId: turnResult.turnId,
    }
  }

  const identityValidation = validateAssessmentIdentity(packet, parsed.data)
  if (!identityValidation.valid) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'tool_call_assessment',
        error_kind: 'identity_mismatch',
        message: 'LLM response matched the schema but not the expected packet identity',
        detail: {
          raw_response: turnResult.responseText,
          expected: {
            turn_id: packet.turn_id,
            round_id: packet.round_id,
            tool_call_part_id: packet.tool_call_part_id,
            tool_name: packet.tool_name,
          },
          actual: {
            turn_id: parsed.data.turn_id,
            round_id: parsed.data.round_id,
            tool_call_part_id: parsed.data.tool_call_part_id,
            tool_name: parsed.data.tool_name,
          },
          failures: identityValidation.failures,
        },
      },
      metadata: {
        schema_key: SCHEMA_KEY.DIAGNOSTIC,
        tool_call_part_id: packet.tool_call_part_id,
        turn_id: packet.turn_id,
        round_id: packet.round_id,
      },
      createdAt: parseTs,
    })

    return {
      updatedState: {
        ...state,
        phase: 'error',
        awaitingContextMutation: false,
        pendingMutationTurnId: null,
        pendingInjectPartIds: [],
        pendingReasoningPartIds: [],
      },
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
      tool_call_part_id: packet.tool_call_part_id,
      turn_id: packet.turn_id,
      round_id: packet.round_id,
      tool_name: packet.tool_name,
    },
    createdAt: parseTs,
  })

  const updatedState: AnalysisSessionState = {
    ...state,
    awaitingContextMutation: true,
    pendingMutationTurnId: turnResult.turnId,
    pendingInjectPartIds: injectPartIds,
    pendingReasoningPartIds: turnResult.assistantReasoningPartIds,
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

/**
 * Builds the short assessment question that becomes the LLM turn's user message.
 */
function buildAssessmentQuestion(packet: EvidencePacket, analysisTarget: AnalysisTarget): string {
  return `Based on the evidence above, assess the tool call ${packet.tool_call_part_id} (${packet.tool_name}).

${buildAnalysisFocusInstructions(analysisTarget)}

Work in three evidence buckets:
1. Pre-call intent: what the assistant appeared to be trying to accomplish before the tool call, based only on the inspected reasoning before the call.
2. Tool call correctness: whether the chosen tool and its concrete arguments matched that intent. If something is wrong or questionable, name the exact parameter, argument, or field.
3. Post-call usage: whether the tool result was interpreted and used correctly in the subsequent reasoning or answer. If there is no meaningful post-call reasoning, say that explicitly.

Specificity rules:
- Default to a sparse payload for routine success cases.
- If the tool call worked exactly as expected and the reasoning before/after adds nothing non-obvious, return null for post_call_assessment.
- For routine-success cases, keep tool_call_assessment to one short sentence.
- Only fill optional fields when they add new diagnostic value beyond what is already obvious from the tool call and result.
- If you call out a problem, identify the exact parameter, argument value, result field, or quoted tool-description wording involved.
- If the evidence is insufficient for one bucket, say that explicitly in that bucket instead of guessing.
- Use parameter_or_call_issues only for concrete issues in the invoked tool call or its arguments.
- Use post_call_assessment only when the result interpretation was wrong, non-obvious, or otherwise diagnostically important. Otherwise return null.
- Do not repeat the same explanation across multiple fields.

Return exactly one JSON object with this shape (no prose, just JSON):
{
  "turn_id": "${packet.turn_id}",
  "round_id": "${packet.round_id}",
  "tool_call_part_id": "${packet.tool_call_part_id}",
  "tool_name": "${packet.tool_name}",
  "expectation_match": "match" | "partial_match" | "mismatch" | "unclear",
  "tool_call_assessment": "<one or two sentences assessing the tool choice and exact arguments; name specific parameters or values when relevant>",
  "most_direct_cause": "wrong_parameters" | "tool_misunderstanding" | "tool_description_clarity" | "tool_surface_mismatch" | "tool_limitation" | "unclear" | null,
  "parameter_or_call_issues": ["<specific issue mentioning an exact parameter, argument, or field>", "..."],
  "post_call_assessment": "<optional one or two sentences assessing how the result was interpreted and used afterwards, or null>"
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

