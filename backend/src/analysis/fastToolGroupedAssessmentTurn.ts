import crypto from 'node:crypto'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import { getSessionRecord } from '../persistence/repository.js'
import { insertJsonArtifact } from './artifactRepository.js'
import {
  runDeterministicMcpToolCallsInSingleTurn,
  type McpGateway,
} from '../runtime/toolTurns.js'
import { runAnalysisTurn } from './boundedTurn.js'
import {
  buildAnalysisFocusInstructions,
  fastToolGroupedAssessmentSchema,
  SCHEMA_KEY,
  type AnalysisSessionState,
  type AnalysisTarget,
  type FastToolWorkGroup,
} from './schemas.js'
import type { ZodError } from 'zod'
import type { AnalysisStreamEventSink } from '../runtime/streamEvents.js'
import { runFastToolContextMutationStep } from './fastToolContextMutationStep.js'
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

export interface FastToolGroupedAssessmentInput {
  state: AnalysisSessionState
  stepId: string
  workUnit: FastToolWorkGroup
  analysisTarget: AnalysisTarget
}

export interface FastToolGroupedAssessmentResult {
  updatedState: AnalysisSessionState
  assessmentArtifactId: string | null
  success: boolean
}

export async function runFastToolGroupedAssessmentTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  input: FastToolGroupedAssessmentInput,
  emitEvent?: AnalysisStreamEventSink,
): Promise<FastToolGroupedAssessmentResult> {
  const { state, stepId, workUnit, analysisTarget } = input
  const analysisSession = getSessionRecord(database.connection, state.analysisSessionId)
  if (!analysisSession) {
    throw new Error(`Fast grouped assessment: analysis session not found: ${state.analysisSessionId}`)
  }

  const injectPartIds: string[] = []
  const evidencePartIds = [
    ...workUnit.reasoning_before_part_ids,
    ...workUnit.tool_call_part_ids,
    ...workUnit.tool_result_part_ids,
    ...workUnit.reasoning_after_part_ids,
  ].filter((value, index, all) => all.indexOf(value) === index)

  const { toolCallPartIds, toolResultPartIds } = await runDeterministicMcpToolCallsInSingleTurn(
    database,
    mcpGateway,
    analysisSession,
    evidencePartIds.map(id => ({ toolName: 'mcpscope_inspect', toolArgs: { id } })),
    emitEvent,
    stepId,
  )
  injectPartIds.push(...toolCallPartIds, ...toolResultPartIds)

  const turnResult = await runAnalysisTurn(
    database,
    lmGateway,
    mcpGateway,
    state.analysisSessionId,
    buildGroupedAssessmentQuestion(workUnit, analysisTarget),
    emitEvent,
    stepId,
  )

  const ts = now()
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(extractJsonBlock(turnResult.responseText))
  } catch (error) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_tool_group_assessment',
        error_kind: 'json_parse_error',
        message: 'Fast tool grouped assessment response was not valid JSON',
        detail: { raw_response: turnResult.responseText, error: String(error) },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC, work_unit_id: workUnit.work_unit_id },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, assessmentArtifactId: null, success: false }
  }

  const parsed = fastToolGroupedAssessmentSchema.safeParse(parsedJson)
  if (!parsed.success) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_tool_group_assessment',
        error_kind: 'schema_validation_error',
        message: 'Fast tool grouped assessment response did not match schema',
        detail: { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC, work_unit_id: workUnit.work_unit_id },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, assessmentArtifactId: null, success: false }
  }

  const identityFailures = validateGroupedAssessmentIdentity(workUnit, parsed.data)
  if (identityFailures.length > 0) {
    insertJsonArtifact(database.connection, {
      id: uuid(),
      sessionId: state.analysisSessionId,
      stepId,
      content: {
        step_type: 'fast_tool_group_assessment',
        error_kind: 'identity_mismatch',
        message: 'Fast tool grouped assessment matched schema but not expected work-unit identity',
        detail: { raw_response: turnResult.responseText, failures: identityFailures },
      },
      metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC, work_unit_id: workUnit.work_unit_id },
      createdAt: ts,
    })
    return { updatedState: { ...state, phase: 'error' }, assessmentArtifactId: null, success: false }
  }

  const assessmentArtifactId = uuid()
  insertJsonArtifact(database.connection, {
    id: assessmentArtifactId,
    sessionId: state.analysisSessionId,
    stepId,
    content: parsed.data,
    metadata: {
      schema_key: SCHEMA_KEY.FAST_TOOL_GROUP_ASSESSMENT,
      work_unit_id: workUnit.work_unit_id,
      tool_name: workUnit.tool_name,
    },
    createdAt: ts,
  })

  const { nextPhase } = runFastToolContextMutationStep(database, {
    analysisSessionId: state.analysisSessionId,
    nextWorkUnitIndex: state.nextPacketIndex + 1,
    totalWorkUnitCount: state.packetCount,
    injectPartIds,
    reasoningPartIds: turnResult.assistantReasoningPartIds,
    userTurnId: turnResult.turnId,
  })

  return {
    updatedState: {
      ...state,
      nextPacketIndex: state.nextPacketIndex + 1,
      phase: nextPhase,
    },
    assessmentArtifactId,
    success: true,
  }
}

function validateGroupedAssessmentIdentity(
  workUnit: FastToolWorkGroup,
  parsed: ReturnType<typeof fastToolGroupedAssessmentSchema.parse>,
): string[] {
  const failures: string[] = []
  if (parsed.work_unit_id !== workUnit.work_unit_id) {
    failures.push(`work_unit_id mismatch: expected ${workUnit.work_unit_id}, got ${parsed.work_unit_id}`)
  }
  if (parsed.tool_name !== workUnit.tool_name) {
    failures.push(`tool_name mismatch: expected ${workUnit.tool_name}, got ${parsed.tool_name}`)
  }
  if (parsed.total_tool_calls !== workUnit.tool_call_part_ids.length) {
    failures.push(`total_tool_calls mismatch: expected ${workUnit.tool_call_part_ids.length}, got ${parsed.total_tool_calls}`)
  }
  if (!sameSet(parsed.tool_call_part_ids, workUnit.tool_call_part_ids)) {
    failures.push('tool_call_part_ids mismatch')
  }
  if (!sameSet(parsed.turn_ids, workUnit.turn_ids)) {
    failures.push('turn_ids mismatch')
  }
  return failures
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value))
}

function buildGroupedAssessmentQuestion(workUnit: FastToolWorkGroup, analysisTarget: AnalysisTarget): string {
  return renderPromptResource('fast-tool.group-assessment.txt', {
    analysis_focus_instructions: buildAnalysisFocusInstructions(analysisTarget),
    work_unit_id: workUnit.work_unit_id,
    tool_name: workUnit.tool_name,
    tool_call_part_ids_json: workUnit.tool_call_part_ids.map(id => JSON.stringify(id)).join(', '),
    turn_ids_json: workUnit.turn_ids.map(id => JSON.stringify(id)).join(', '),
    total_tool_calls: workUnit.tool_call_part_ids.length,
  })
}