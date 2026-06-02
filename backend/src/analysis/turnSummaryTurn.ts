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
  getPartRecord,
  updatePartRecord,
} from '../persistence/repository.js'
import {
  insertJsonArtifact,
  getLatestArtifactBySchemaKey,
  listArtifactsBySessionAndSchemaKey,
} from './artifactRepository.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import { runAnalysisTurn } from './boundedTurn.js'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import {
  buildAnalysisFocusInstructions,
  SCHEMA_KEY,
  turnSummarySchema,
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvidencePacketIndex,
  type ToolCallAssessment,
  type TurnSummary,
} from './schemas.js'
import type { ZodError } from 'zod'
import { renderPromptResource } from './promptResources.js'

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

function firstSentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return trimmed
  const sentence = trimmed.match(/^.*?[.!?](?:\s|$)/)
  return sentence?.[0]?.trim() ?? trimmed
}

function buildRepeatedToolSummary(turnPackets: EvidencePacketIndex['packets']): string[] {
  const counts = new Map<string, number>()
  for (const packet of turnPackets) {
    counts.set(packet.tool_name, (counts.get(packet.tool_name) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([toolName, count]) => `${toolName} (${count} attempts)`)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function describeValuePreview(value: unknown): string {
  if (typeof value === 'string') {
    return `string(${value})`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    const rendered = `array(${value.map(item => describeValuePreview(item)).join(', ')})`
    return rendered.length <= 200 ? rendered : `${rendered.slice(0, 197)}...`
  }
  if (value && typeof value === 'object') {
    const rendered = `object(${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${key}=${describeValuePreview(child)}`)
      .join(', ')})`
    return rendered.length <= 200 ? rendered : `${rendered.slice(0, 197)}...`
  }
  const json = stableJson(value)
  return json.length <= 200 ? json : `${json.slice(0, 197)}...`
}

function parseToolCallArgs(partId: string, database: BackendDatabase): Record<string, unknown> {
  const toolCallPart = getPartRecord(database.connection, partId)
  const payload = toolCallPart?.payload.json as { arguments?: string } | null
  if (!payload?.arguments) {
    return {}
  }

  try {
    const parsed = JSON.parse(payload.arguments) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }

  return {}
}

function getToolResultOutcome(packet: EvidencePacketIndex['packets'][number], database: BackendDatabase): 'error' | 'success' | 'unknown' {
  if (!packet.tool_result_part_id) {
    return 'unknown'
  }

  const toolResultPart = getPartRecord(database.connection, packet.tool_result_part_id)
  const provenance = toolResultPart?.provenanceJson as { isError?: boolean } | null
  if (provenance?.isError === true) {
    return 'error'
  }
  if (toolResultPart) {
    return 'success'
  }
  return 'unknown'
}

function describeArgumentDifferences(previousArgs: Record<string, unknown>, nextArgs: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(previousArgs), ...Object.keys(nextArgs)])].sort((left, right) => left.localeCompare(right))
  const differences: string[] = []

  for (const key of keys) {
    const previousValue = previousArgs[key]
    const nextValue = nextArgs[key]
    if (stableJson(previousValue) === stableJson(nextValue)) {
      continue
    }

    if (!(key in previousArgs)) {
      differences.push(`${key} added as ${describeValuePreview(nextValue)}`)
      continue
    }
    if (!(key in nextArgs)) {
      differences.push(`${key} removed (was ${describeValuePreview(previousValue)})`)
      continue
    }
    differences.push(`${key}: ${describeValuePreview(previousValue)} -> ${describeValuePreview(nextValue)}`)
  }

  return differences
}

export function buildRepeatedAttemptGuidance(
  database: BackendDatabase,
  turnPackets: EvidencePacketIndex['packets'],
): string | null {
  const packetsByTool = new Map<string, EvidencePacketIndex['packets']>()
  for (const packet of turnPackets) {
    const existing = packetsByTool.get(packet.tool_name)
    if (existing) {
      existing.push(packet)
    } else {
      packetsByTool.set(packet.tool_name, [packet])
    }
  }

  const sections: string[] = []

  for (const [toolName, packets] of packetsByTool.entries()) {
    if (packets.length < 2) {
      continue
    }

    sections.push(`- ${toolName}:`)
    let previousArgs: Record<string, unknown> | null = null
    let previousPartId: string | null = null

    for (const packet of packets) {
      const args = parseToolCallArgs(packet.tool_call_part_id, database)
      const outcome = getToolResultOutcome(packet, database)
      sections.push(`  - ${packet.tool_call_part_id}: outcome=${outcome}; call=${describeValuePreview(args)}`)

      if (previousArgs && previousPartId) {
        const differences = describeArgumentDifferences(previousArgs, args)
        sections.push(
          differences.length === 0
            ? `    same call payload as ${previousPartId}`
            : `    diff vs ${previousPartId}: ${differences.join('; ')}`,
        )
      }

      previousArgs = args
      previousPartId = packet.tool_call_part_id
    }
  }

  return sections.length > 0 ? sections.join('\n') : null
}

function validateTurnSummaryIdentity(
  currentTurnId: string,
  turnPackets: EvidencePacketIndex['packets'],
  parsed: {
    turn_id: string
    total_tool_calls_assessed: number
    cross_attempt_reconciliation: string | null
    per_tool_findings: Array<{
      tool_call_part_id: string
      tool_name: string
    }>
  },
): string[] {
  const failures: string[] = []

  if (parsed.turn_id !== currentTurnId) {
    failures.push(`turn_id mismatch: expected ${currentTurnId}, got ${parsed.turn_id}`)
  }

  if (parsed.total_tool_calls_assessed !== turnPackets.length) {
    failures.push(`total_tool_calls_assessed mismatch: expected ${turnPackets.length}, got ${parsed.total_tool_calls_assessed}`)
  }

  const repeatedTools = buildRepeatedToolSummary(turnPackets)
  if (repeatedTools.length > 0 && (!parsed.cross_attempt_reconciliation || parsed.cross_attempt_reconciliation.trim().length === 0)) {
    failures.push(`cross_attempt_reconciliation is required when repeated tools are present: ${repeatedTools.join(', ')}`)
  }

  const expectedByToolCallPartId = new Map(
    turnPackets.map(packet => [packet.tool_call_part_id, packet.tool_name]),
  )
  const seen = new Set<string>()

  for (const finding of parsed.per_tool_findings) {
    const expectedToolName = expectedByToolCallPartId.get(finding.tool_call_part_id)
    if (!expectedToolName) {
      failures.push(`unexpected tool_call_part_id in summary: ${finding.tool_call_part_id}`)
      continue
    }
    if (seen.has(finding.tool_call_part_id)) {
      failures.push(`duplicate tool_call_part_id in summary: ${finding.tool_call_part_id}`)
    }
    seen.add(finding.tool_call_part_id)

    if (finding.tool_name !== expectedToolName) {
      failures.push(`tool_name mismatch for ${finding.tool_call_part_id}: expected ${expectedToolName}, got ${finding.tool_name}`)
    }
  }

  for (const packet of turnPackets) {
    if (!seen.has(packet.tool_call_part_id)) {
      failures.push(`missing tool_call_part_id in summary: ${packet.tool_call_part_id}`)
    }
  }

  return failures
}

function retireSummaryTurnPromptContext(
  database: BackendDatabase,
  userPartId: string,
  assistantReasoningPartIds: string[],
): void {
  const updatedAt = now()

  if (userPartId) {
    const userPart = getPartRecord(database.connection, userPartId)
    if (userPart) {
      updatePartRecord(database.connection, {
        ...userPart,
        context: {
          ...userPart.context,
          state: 'historical-only',
          note: 'Turn summary question excluded from active context after summary completed',
        },
        updatedAt,
      })
    }
  }

  for (const partId of assistantReasoningPartIds) {
    const reasoningPart = getPartRecord(database.connection, partId)
    if (!reasoningPart) {
      continue
    }
    updatePartRecord(database.connection, {
      ...reasoningPart,
      context: {
        ...reasoningPart.context,
        state: 'excluded',
        note: 'Turn summary reasoning excluded after summary completed',
      },
      updatedAt,
    })
  }
}

function buildDeterministicTurnSummary(
  turnPackets: EvidencePacketIndex['packets'],
  assessments: ToolCallAssessment[],
): TurnSummary | null {
  if (turnPackets.length !== 1 || assessments.length !== 1) {
    return null
  }

  const assessment = assessments[0]
  if (!assessment) {
    return null
  }

  const isCleanSuccess = assessment.expectation_match === 'match'
    && assessment.most_direct_cause === null
    && assessment.parameter_or_call_issues.length === 0

  if (!isCleanSuccess) {
    return null
  }

  return {
    turn_id: assessment.turn_id,
    total_tool_calls_assessed: 1,
    turn_outcome: 'successful',
    turn_outcome_rationale: assessment.post_call_assessment
      ? 'The single tool call matched expectations and its result was used correctly.'
      : 'The single tool call matched expectations.',
    per_tool_findings: [
      {
        tool_call_part_id: assessment.tool_call_part_id,
        tool_name: assessment.tool_name,
        brief_finding: firstSentence(assessment.tool_call_assessment),
      },
    ],
    cross_attempt_reconciliation: null,
  }
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
  const analysisTargetArtifact = getLatestArtifactBySchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.ANALYSIS_TARGET,
  )
  if (!analysisTargetArtifact) {
    throw new Error('TurnSummaryTurn: analysis_target artifact missing')
  }
  const analysisTarget = analysisTargetArtifact.content as AnalysisTarget
  const repeatedTools = buildRepeatedToolSummary(turnPackets)
  const repeatedAttemptGuidance = buildRepeatedAttemptGuidance(database, turnPackets)
  const assessmentArtifacts = listArtifactsBySessionAndSchemaKey(
    database.connection,
    analysisSessionId,
    SCHEMA_KEY.TOOL_CALL_ASSESSMENT,
  )
  const assessmentsForTurn = assessmentArtifacts
    .filter(artifact => (artifact.metadata.turn_id as string | undefined) === currentTurnId)
    .map(artifact => artifact.content as ToolCallAssessment)
  const deterministicSummary = repeatedTools.length === 0
    ? buildDeterministicTurnSummary(turnPackets, assessmentsForTurn)
    : null

  if (deterministicSummary) {
    const summaryArtifactId = uuid()
    insertJsonArtifact(database.connection, {
      id: summaryArtifactId,
      sessionId: analysisSessionId,
      stepId,
      content: deterministicSummary,
      metadata: {
        schema_key: SCHEMA_KEY.TURN_SUMMARY,
        turn_id: currentTurnId,
        total_assessed: turnPackets.length,
        synthesis_mode: 'deterministic_single_success',
      },
      createdAt: now(),
    })

    const hasMorePackets = state.nextPacketIndex < state.packetCount
    return {
      updatedState: {
        ...state,
        phase: hasMorePackets ? 'assessing' : 'coverage_validation',
        currentTurnId: null,
      },
      summaryArtifactId,
      success: true,
    }
  }

  // ── Build summary question ────────────────────────────────────────────────
  // The accumulated context already contains the turn context inject and all
  // assessment result parts for this turn.
  const summaryQuestion = renderPromptResource('full.turn-summary.txt', {
    analysis_focus_instructions: buildAnalysisFocusInstructions(analysisTarget),
    current_turn_id: currentTurnId,
    turn_packet_count: turnPackets.length,
    repeated_tools: repeatedTools.length > 0 ? repeatedTools.join(', ') : 'none',
    repeated_attempt_guidance_block: repeatedAttemptGuidance ? `\n${repeatedAttemptGuidance}` : ' none',
  })

  // ── Run context-aware LLM turn ────────────────────────────────────────────
  const turnResult = await runAnalysisTurn(
    database,
    lmGateway,
    mcpGateway,
    analysisSessionId,
    summaryQuestion,
    emitEvent,
    input.stepId,
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

  const identityFailures = validateTurnSummaryIdentity(currentTurnId, turnPackets, parsed.data)
  if (identityFailures.length > 0) {
    const diagnosticId = uuid()
    insertJsonArtifact(database.connection, {
      id: diagnosticId,
      sessionId: analysisSessionId,
      stepId,
      content: {
        step_type: 'turn_summary',
        error_kind: 'identity_mismatch',
        message: 'Turn summary matched the schema but not the expected turn packet identities',
        detail: {
          raw_response: turnResult.responseText,
          turn_id: currentTurnId,
          expected_packets: turnPackets.map(packet => ({
            tool_call_part_id: packet.tool_call_part_id,
            tool_name: packet.tool_name,
          })),
          actual_findings: parsed.data.per_tool_findings.map(finding => ({
            tool_call_part_id: finding.tool_call_part_id,
            tool_name: finding.tool_name,
          })),
          failures: identityFailures,
        },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC, turn_id: currentTurnId },
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

  retireSummaryTurnPromptContext(
    database,
    turnResult.userPartId,
    turnResult.assistantReasoningPartIds,
  )

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
