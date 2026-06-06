import crypto from 'node:crypto'
import type { BackendDatabase } from '../../persistence/db.js'
import type { LmStudioGateway } from '../../runtime/modelTurns.js'
import type { McpGateway } from '../../runtime/toolTurns.js'
import { WorkflowStep } from '../../workflow/workflowStep.js'
import type { StepContext } from '../../workflow/stepContext.js'
import type { StepResult } from '../../domain/executionModel.js'
import { getSessionRecord, getPartRecord, updatePartRecord } from '../../persistence/repository.js'
import { insertJsonArtifact, getLatestArtifactBySchemaKey, listArtifactsBySessionAndSchemaKey } from '../artifactRepository.js'
import { runAnalysisTurn } from '../boundedTurn.js'
import {
  SCHEMA_KEY,
  evaluationResultSchema,
  type AnalysisSessionState,
  type AnalysisTarget,
  type EvidencePacketIndex,
  type EvaluationResult,
} from '../schemas.js'
import type { ZodError } from 'zod'

function uuid(): string { return crypto.randomUUID() }
function now(): number { return Date.now() }

export interface TurnSummaryStepConfig {
  assessmentSchemaKey: string
  summarySchemaKey: string
  buildPrompt: (params: Record<string, unknown>) => string
}

export class TurnSummaryStep extends WorkflowStep<AnalysisSessionState> {
  readonly stepLabel = 'Turn Summary'

  constructor(
    db: BackendDatabase,
    lm: LmStudioGateway,
    mcp: McpGateway,
    private readonly config: TurnSummaryStepConfig,
  ) {
    super(db, lm, mcp)
  }

  protected async run(ctx: StepContext<AnalysisSessionState>): Promise<StepResult> {
    const state = ctx.workflowState
    if (!state) throw new Error('TurnSummaryStep: workflowState required')

    const { analysisSessionId, currentTurnId } = state
    if (!currentTurnId) throw new Error('TurnSummaryStep: currentTurnId is null')

    const analysisSession = getSessionRecord(this.db.connection, analysisSessionId)
    if (!analysisSession) throw new Error(`TurnSummary: session not found: ${analysisSessionId}`)

    const packetIndexArtifact = getLatestArtifactBySchemaKey(this.db.connection, analysisSessionId, SCHEMA_KEY.EVIDENCE_PACKET_INDEX)
    const packetIndex = packetIndexArtifact?.content as EvidencePacketIndex | undefined
    const turnPackets = packetIndex?.packets.filter(p => p.turn_id === currentTurnId) ?? []

    const analysisTargetArtifact = getLatestArtifactBySchemaKey(this.db.connection, analysisSessionId, SCHEMA_KEY.ANALYSIS_TARGET)
    if (!analysisTargetArtifact) throw new Error('TurnSummary: analysis_target missing')
    const analysisTarget = analysisTargetArtifact.content as AnalysisTarget

    const repeatedTools = buildRepeatedToolSummary(turnPackets)
    const repeatedAttemptGuidance = repeatedTools.length > 0
      ? buildRepeatedAttemptGuidance(this.db, turnPackets) : null
    const assessmentArtifacts = listArtifactsBySessionAndSchemaKey(this.db.connection, analysisSessionId, this.config.assessmentSchemaKey)
    const assessmentsForTurn = assessmentArtifacts
      .filter(a => (a.metadata.turn_id as string | undefined) === currentTurnId)
      .map(a => a.content as EvaluationResult)

    if (repeatedTools.length === 0) {
      const det = buildDeterministicTurnSummary(currentTurnId, turnPackets, assessmentsForTurn)
      if (det) {
        insertJsonArtifact(this.db.connection, {
          id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
          content: det,
          metadata: {
            schema_key: this.config.summarySchemaKey, turn_id: currentTurnId,
            total_assessed: turnPackets.length, synthesis_mode: 'deterministic_single_success',
          },
          createdAt: now(),
        })
        Object.assign(state, {
          phase: state.nextPacketIndex < state.packetCount ? 'assessing' : 'coverage_validation',
          currentTurnId: null,
        })
        return { status: 'complete', outputArtifacts: [] }
      }
    }

    const summaryQuestion = this.config.buildPrompt({
      analysisTarget,
      subjectId: currentTurnId,
      currentTurnId,
      repeatedTools,
      repeatedAttemptGuidance: repeatedTools.length > 0 ? repeatedAttemptGuidance : null,
      turnPacketCount: turnPackets.length,
    })

    const turnResult = await runAnalysisTurn(
      this.db, this.lm, this.mcp, analysisSessionId,
      summaryQuestion, ctx.emitSink, this.stepId,
    )

    const ts = now()
    let parsedJson: unknown
    try { parsedJson = JSON.parse(extractJsonBlock(turnResult.responseText)) } catch (e) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'turn_summary', error_kind: 'json_parse_error', message: 'Not valid JSON', detail: { raw_response: turnResult.responseText, error: String(e), turn_id: currentTurnId } },
        metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC }, createdAt: ts,
      })
      state.phase = 'error'
      return { status: 'complete', outputArtifacts: [] }
    }

    const parsed = evaluationResultSchema.safeParse(parsedJson)
    if (!parsed.success) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'turn_summary', error_kind: 'schema_validation_error', message: 'Schema mismatch', detail: { raw_response: turnResult.responseText, errors: (parsed.error as ZodError).issues, turn_id: currentTurnId } },
        metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC }, createdAt: ts,
      })
      state.phase = 'error'
      return { status: 'complete', outputArtifacts: [] }
    }

    if (parsed.data.subject_id !== currentTurnId) {
      insertJsonArtifact(this.db.connection, {
        id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
        content: { step_type: 'turn_summary', error_kind: 'identity_mismatch', message: 'Subject mismatch', detail: { raw_response: turnResult.responseText, expected_subject_id: currentTurnId, actual_subject_id: parsed.data.subject_id } },
        metadata: { schema_key: SCHEMA_KEY.DIAGNOSTIC, turn_id: currentTurnId }, createdAt: ts,
      })
      state.phase = 'error'
      return { status: 'complete', outputArtifacts: [] }
    }

    insertJsonArtifact(this.db.connection, {
      id: uuid(), sessionId: analysisSessionId, stepId: this.stepId,
      content: parsed.data,
      metadata: { schema_key: this.config.summarySchemaKey, turn_id: currentTurnId, total_assessed: turnPackets.length },
      createdAt: ts,
    })

    retireSummaryPromptContext(this.db, turnResult.userPartId, turnResult.assistantReasoningPartIds)
    Object.assign(state, {
      phase: state.nextPacketIndex < state.packetCount ? 'assessing' : 'coverage_validation',
      currentTurnId: null,
    })

    return { status: 'complete', outputArtifacts: [] }
  }
}

function buildRepeatedToolSummary(packets: EvidencePacketIndex['packets']): string[] {
  const counts = new Map<string, number>()
  for (const p of packets) counts.set(p.tool_name, (counts.get(p.tool_name) ?? 0) + 1)
  return [...counts.entries()].filter(([, c]) => c > 1).map(([t, c]) => `${t} (${c} attempts)`)
}

export function buildRepeatedAttemptGuidance(database: BackendDatabase, turnPackets: EvidencePacketIndex['packets']): string | null {
  const byTool = new Map<string, EvidencePacketIndex['packets']>()
  for (const p of turnPackets) { const e = byTool.get(p.tool_name); if (e) e.push(p); else byTool.set(p.tool_name, [p]) }
  const sections: string[] = []
  for (const [toolName, packets] of byTool) {
    if (packets.length < 2) continue
    sections.push(`- ${toolName}:`)
    let prev: Record<string, unknown> | null = null; let prevId: string | null = null
    for (const p of packets) {
      const args = parseToolCallArgs(p.tool_call_part_id, database)
      const outcome = getToolResultOutcome(p, database)
      sections.push(`  - ${p.tool_call_part_id}: outcome=${outcome}; call=${describeValuePreview(args)}`)
      if (prev && prevId) {
        const diffs = describeArgumentDifferences(prev, args)
        sections.push(diffs.length === 0 ? `    same call payload as ${prevId}` : `    diff vs ${prevId}: ${diffs.join('; ')}`)
      }
      prev = args; prevId = p.tool_call_part_id
    }
  }
  return sections.length > 0 ? sections.join('\n') : null
}

function parseToolCallArgs(partId: string, database: BackendDatabase): Record<string, unknown> {
  const p = getPartRecord(database.connection, partId)
  const payload = p?.payload.json as { arguments?: string } | null
  if (!payload?.arguments) return {}
  try { const parsed = JSON.parse(payload.arguments) as unknown; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown> } catch { return {} }
  return {}
}

function getToolResultOutcome(p: EvidencePacketIndex['packets'][number], database: BackendDatabase): 'error' | 'success' | 'unknown' {
  if (!p.tool_result_part_id) return 'unknown'
  const part = getPartRecord(database.connection, p.tool_result_part_id)
  const prov = part?.provenanceJson as { isError?: boolean } | null
  if (prov?.isError === true) return 'error'
  return part ? 'success' : 'unknown'
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function describeValuePreview(value: unknown): string {
  if (typeof value === 'string') return `string(${value})`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const rendered = `array(${value.map(item => describeValuePreview(item)).join(', ')})`
    return rendered.length <= 200 ? rendered : `${rendered.slice(0, 197)}...`
  }
  if (value && typeof value === 'object') {
    const rendered = `object(${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${describeValuePreview(v)}`).join(', ')})`
    return rendered.length <= 200 ? rendered : `${rendered.slice(0, 197)}...`
  }
  const json = stableJson(value)
  return json.length <= 200 ? json : `${json.slice(0, 197)}...`
}

function describeArgumentDifferences(prev: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort()
  const diffs: string[] = []
  for (const k of keys) {
    if (stableJson(prev[k]) === stableJson(next[k])) continue
    if (!(k in prev)) { diffs.push(`${k} added as ${describeValuePreview(next[k])}`); continue }
    if (!(k in next)) { diffs.push(`${k} removed (was ${describeValuePreview(prev[k])})`); continue }
    diffs.push(`${k}: ${describeValuePreview(prev[k])} -> ${describeValuePreview(next[k])}`)
  }
  return diffs
}

function firstSentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return trimmed
  const sentence = trimmed.match(/^.*?[.!?](?:\s|$)/)
  return sentence?.[0]?.trim() ?? trimmed
}

function buildDeterministicTurnSummary(currentTurnId: string, turnPackets: EvidencePacketIndex['packets'], assessments: EvaluationResult[]): EvaluationResult | null {
  if (turnPackets.length !== 1 || assessments.length !== 1) return null
  const a = assessments[0]
  if (!a) return null
  return {
    subject_scope: 'turn', subject_id: currentTurnId,
    evaluation_focus: 'Summarize the overall quality of this turn’s tool usage.',
    reasoning: firstSentence(a.reasoning), verdict: a.verdict, score: a.score,
    evidence_part_id: a.evidence_part_id ?? null,
  }
}

function retireSummaryPromptContext(database: BackendDatabase, userPartId: string, reasoningPartIds: string[]): void {
  const ts = now()
  if (userPartId) {
    const up = getPartRecord(database.connection, userPartId)
    if (up) updatePartRecord(database.connection, { ...up, context: { ...up.context, state: 'historical-only', note: 'Turn summary question excluded' }, updatedAt: ts })
  }
  for (const id of reasoningPartIds) {
    const rp = getPartRecord(database.connection, id)
    if (!rp) continue
    updatePartRecord(database.connection, { ...rp, context: { ...rp.context, state: 'excluded', note: 'Turn summary reasoning excluded' }, updatedAt: ts })
  }
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
