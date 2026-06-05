import type Database from 'better-sqlite3'
import type { PartRecord, RoundRecord, StepRecord, TurnRecord } from '../domain/model.js'
import { formatSetupId, parseHierarchicalId } from '../domain/hierarchicalIds.js'
import {
  getPartRecord,
  getRoundRecord,
  getSessionRecord,
  getStepRecord,
  getTurnRecord,
  listPartRecordsBySession,
  listRoundRecordsBySession,
  listStepRecordsBySession,
  listTurnRecordsBySession,
} from '../persistence/repository.js'
import { listArtifactsBySession } from '../analysis/artifactRepository.js'
import {
  getAnalysisWorkflowKindFromStep,
  getAnalysisWorkflowLabel,
  getLatestAnalysisDiagnosticSummary,
  getLatestAnalysisDiagnosticSummaryForStep,
} from '../analysis/analysisSessionPresentation.js'

type LookupMode = 'summary' | 'full'

type LookupSuccess = {
  status: 'ok'
  payload: {
    id: string
    type: 'session' | 'setup' | 'step' | 'turn' | 'round' | 'part'
    mode: LookupMode
    data: unknown
  }
}

type LookupFailure =
  | { status: 'invalid'; message: string }
  | { status: 'not_found'; message: string }

// ─── Canonical type mapping ───────────────────────────────────────────────────

const CANONICAL_PART_TYPE: Record<string, string> = {
  'system-prompt': 'system_prompt',
  'mcp-instructions': 'mcp_instructions',
  'tool-definitions': 'tool_definitions',
  'user-message': 'user_prompt',
  'assistant-reasoning': 'reasoning',
  'assistant-content': 'assistant_answer',
  'tool-call': 'tool_call',
  'diagnostic-note': 'diagnostic',
}

const CANONICAL_CONTEXT_STATE: Record<string, string> = {
  'included': 'included',
  'excluded': 'excluded',
  'stripped': 'stripped',
  'historical-only': 'historical_only',
  'round-only': 'round_only',
}

function canonicalPartType(partType: string): string | null {
  return CANONICAL_PART_TYPE[partType] ?? null
}

function canonicalContextState(state: string): string {
  return CANONICAL_CONTEXT_STATE[state] ?? state
}

// ─── Part helpers ─────────────────────────────────────────────────────────────

function isPublicPartType(partType: string): boolean {
  return partType !== 'tool-result'
}

function extractToolName(part: PartRecord): string | null {
  if (part.partType !== 'tool-call') return null
  const json = part.payload.json as { name?: string; toolName?: string } | null
  return String(json?.name ?? json?.toolName ?? part.payload.summary ?? 'unknown')
}

function mergedToolCallTokens(callPart: PartRecord, resultParts: PartRecord[]): number | null {
  const all = [callPart, ...resultParts]
  if (all.every(p => p.tokens.count == null)) return null
  return all.reduce((sum, p) => sum + (p.tokens.count ?? 0), 0)
}

function buildPartNode(
  part: PartRecord,
  resultParts: PartRecord[],
  mode: LookupMode,
  isDirectPartLookup: boolean,
  isPartLevelLookup: boolean = false,
): object | null {
  const publicType = canonicalPartType(part.partType)
  if (!publicType) return null

  const isToolCall = part.partType === 'tool-call'
  const isToolDefinitions = part.partType === 'tool-definitions'
  const tokenCount = isToolCall ? mergedToolCallTokens(part, resultParts) : (part.tokens.count ?? null)
  const contextState = canonicalContextState(part.context.state)

  const base: Record<string, unknown> = {
    id: part.id,
    type: publicType,
    token_count: tokenCount,
    context_state: contextState,
  }

  if (isToolCall) {
    base.tool_name = extractToolName(part)
  }

  // tool_definitions: full content only on direct part-level lookup; tool names in all other contexts
  if (isToolDefinitions) {
    if (isPartLevelLookup && part.payload.json != null) {
      base.content = { json: part.payload.json }
    } else {
      const toolsJson = part.payload.json as Array<{ name: string }> | null
      if (toolsJson) {
        base.tools = toolsJson.map(t => t.name)
      }
    }
    return base
  }

  if (mode === 'full') {
    if (isToolCall && isDirectPartLookup) {
      const callJson = part.payload.json as { arguments?: string } | null
      let parsedArgs: Record<string, unknown> = {}
      try { parsedArgs = JSON.parse(callJson?.arguments ?? '{}') as Record<string, unknown> } catch { /* empty */ }
      const result = resultParts[0]
      const toolResult: Record<string, unknown> = result
        ? (result.payload.text != null ? { text: result.payload.text } : result.payload.json != null ? { json: result.payload.json } : {})
        : {}
      base.tool_payload = { call: parsedArgs, result: toolResult }
    } else if (!isToolCall) {
      const includeContent = isDirectPartLookup
        || part.partType === 'user-message'
        || part.partType === 'assistant-content'
      if (includeContent && part.payload.text != null) {
        base.content = { text: part.payload.text }
      }
    }
  }

  return base
}

// ─── Setup node builder ───────────────────────────────────────────────────────

function buildSetupNode(
  sessionId: string,
  setupParts: PartRecord[],
  mode: LookupMode,
  isDirectLookup: boolean,
): object {
  const parts = setupParts
    .filter(p => isPublicPartType(p.partType))
    .map(p => buildPartNode(p, [], mode, isDirectLookup))
    .filter((n): n is object => n !== null)

  return { id: formatSetupId(sessionId), parts }
}

// ─── Turn/round builders ──────────────────────────────────────────────────────

function buildToolResultIndex(allParts: PartRecord[]): Map<string, PartRecord[]> {
  const map = new Map<string, PartRecord[]>()
  for (const p of allParts) {
    if (p.partType === 'tool-result' && p.parentPartId) {
      map.set(p.parentPartId, [...(map.get(p.parentPartId) ?? []), p])
    }
  }
  return map
}

function buildRoundPartNodes(
  parts: PartRecord[],
  toolResultsByParent: Map<string, PartRecord[]>,
  mode: LookupMode,
  isDirectPartLookup: boolean,
): object[] {
  const nodes: object[] = []
  for (const part of parts) {
    if (part.partType === 'tool-result') continue
    const resultParts = part.partType === 'tool-call' ? (toolResultsByParent.get(part.id) ?? []) : []
    const node = buildPartNode(part, resultParts, mode, isDirectPartLookup)
    if (node) nodes.push(node)
  }
  return nodes
}

function buildRoundNode(
  round: RoundRecord,
  roundParts: PartRecord[],
  toolResultsByParent: Map<string, PartRecord[]>,
  mode: LookupMode,
  isDirectLookup: boolean,
): object {
  const parts = buildRoundPartNodes(roundParts, toolResultsByParent, mode, isDirectLookup)
  return {
    id: round.id,
    number: round.roundIndex + 1,
    ...(round.status ? { status: round.status } : {}),
    parts,
  }
}

function buildTurnNode(
  turn: TurnRecord,
  rounds: RoundRecord[],
  allParts: PartRecord[],
  mode: LookupMode,
  isDirectLookup: boolean,
): object {
  const toolResultsByParent = buildToolResultIndex(allParts)
  const roundNodes = rounds.map(round => {
    const roundParts = allParts
      .filter(p => p.roundId === round.id && isPublicPartType(p.partType))
      .sort((a, b) => a.ordinal - b.ordinal)
    return buildRoundNode(round, roundParts, toolResultsByParent, mode, isDirectLookup)
  })
  return {
    id: turn.id,
    type: 'turn',
    number: turn.sequenceNumber,
    owner_step_id: turn.ownerStepId,
    ...(turn.status ? { status: turn.status } : {}),
    rounds: roundNodes,
  }
}

function getCompactionRemovalReason(strategy: string | null, part: PartRecord | null): string {
  if (strategy === 'strip-reasoning') {
    if (part?.partType === 'assistant-reasoning') {
      return 'Removed from future context because strip-reasoning compaction excludes assistant reasoning parts.'
    }
    return 'Removed from future context by strip-reasoning compaction.'
  }

  return strategy
    ? `Removed from future context by ${strategy} compaction.`
    : 'Removed from future context by compaction.'
}

function buildCompactionStepEvidence(
  step: StepRecord,
  allParts: PartRecord[],
  mode: LookupMode,
): Record<string, unknown> {
  const strippedPartIds = Array.isArray(step.state.strippedPartIds)
    ? step.state.strippedPartIds.filter((value): value is string => typeof value === 'string')
    : []

  const evidence: Record<string, unknown> = {
    stripped_part_ids: strippedPartIds,
  }

  if (mode !== 'full') {
    return evidence
  }

  const partsById = new Map(allParts.map(part => [part.id, part]))
  evidence.stripped_parts = strippedPartIds.map((partId) => {
    const part = partsById.get(partId) ?? null
    return {
      id: partId,
      ...(part ? {
        type: canonicalPartType(part.partType),
        token_count: part.tokens.count ?? null,
        round_id: part.roundId,
      } : {}),
      reason: getCompactionRemovalReason(
        typeof step.params.strategy === 'string' ? step.params.strategy : null,
        part,
      ),
    }
  })

  return evidence
}

function buildStepNode(
  step: StepRecord,
  steps: StepRecord[],
  turns: TurnRecord[],
  rounds: RoundRecord[],
  allParts: PartRecord[],
  artifacts: ReturnType<typeof listArtifactsBySession>,
  mode: LookupMode,
  isDirectLookup: boolean,
): object {
  if (step.stepTypeKey === 'turn') {
    const turn = turns.find(candidate => candidate.id === step.id)
    if (!turn) {
      return {
        id: step.id,
        type: 'turn',
        number: step.ordinal + 1,
        status: step.status,
        rounds: [],
      }
    }

    const turnRounds = rounds
      .filter(round => round.turnId === turn.id)
      .sort((left, right) => left.roundIndex - right.roundIndex)
    return buildTurnNode(turn, turnRounds, allParts, mode, isDirectLookup)
  }

  const ownedTurns = turns
    .filter(candidate => candidate.ownerStepId === step.id)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
  const ownedTurnNodes = ownedTurns.map((turn) => {
    const turnRounds = rounds
      .filter(round => round.turnId === turn.id)
      .sort((left, right) => left.roundIndex - right.roundIndex)
    return buildTurnNode(turn, turnRounds, allParts, mode, isDirectLookup)
  })

  const stepParts = allParts
    .filter(part => part.turnId === step.id && part.roundId === null && isPublicPartType(part.partType))
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(part => buildPartNode(part, [], mode, true))
    .filter((node): node is object => node !== null)

  const ownedTurnIds = ownedTurns.map(candidate => candidate.id)
  const postambleStepIds = ownedTurnIds.flatMap((turnId) => steps
    .filter(candidate => candidate.stepTypeKey === 'compaction' && candidate.params.sourceTurnId === turnId)
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(candidate => candidate.id))

  const compactionEvidence = step.stepTypeKey === 'compaction'
    ? buildCompactionStepEvidence(step, allParts, mode)
    : {}
  const diagnostic = getLatestAnalysisDiagnosticSummaryForStep(artifacts, step.id)
  const workflowKind = step.stepTypeKey === 'analysis_v2_cursor'
    ? getAnalysisWorkflowKindFromStep(step)
    : null
  const workflowLabel = getAnalysisWorkflowLabel(workflowKind)

  return {
    id: step.id,
    type: step.stepTypeKey,
    number: step.ordinal + 1,
    status: step.status,
    ...(workflowKind ? { workflow_kind: workflowKind } : {}),
    ...(workflowLabel ? { workflow_label: workflowLabel } : {}),
    ...(diagnostic ? { latest_error: diagnostic } : {}),
    strategy: typeof step.params.strategy === 'string' ? step.params.strategy : null,
    source_turn_id: typeof step.params.sourceTurnId === 'string' ? step.params.sourceTurnId : null,
    source_turn_number: typeof step.params.sourceTurnSequenceNumber === 'number' ? step.params.sourceTurnSequenceNumber : null,
    stripped_part_count: typeof step.state.strippedPartCount === 'number' ? step.state.strippedPartCount : null,
    context_tokens_before: typeof step.state.contextTokensAtTurnEnd === 'number' ? step.state.contextTokensAtTurnEnd : null,
    context_tokens_after: typeof step.state.contextTokensAfterCompaction === 'number' ? step.state.contextTokensAfterCompaction : null,
    tokens_removed: typeof step.state.compactionTokensRemoved === 'number' ? step.state.compactionTokensRemoved : null,
    owned_turn_ids: ownedTurnIds,
    turns: ownedTurnNodes,
    postamble_step_ids: postambleStepIds,
    ...compactionEvidence,
    parts: stepParts,
  }
}

function deriveContextWindowUsed(turns: TurnRecord[]): number | null {
  const completed = turns.filter(t => t.status === 'complete').sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  return completed.at(-1)?.contextTokensAtTurnEnd ?? null
}

// ─── Main resolver ────────────────────────────────────────────────────────────

export function resolveHierarchicalId(
  connection: Database.Database,
  rawId: string,
  mode: LookupMode,
): LookupSuccess | LookupFailure {
  const parsed = parseHierarchicalId(rawId)
  if (!parsed) {
    return { status: 'invalid', message: `Invalid hierarchical ID: ${rawId}` }
  }

  // ─── Session ───────────────────────────────────────────────────────────────
  if (parsed.type === 'session') {
    const session = getSessionRecord(connection, parsed.sessionId)
    if (!session) return { status: 'not_found', message: `Session not found: ${parsed.sessionId}` }

    const turns = listTurnRecordsBySession(connection, session.id)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    const allSteps = listStepRecordsBySession(connection, session.id)
    const steps = allSteps.filter(step => step.stepTypeKey !== 'analysis_v2_cursor')
    const allParts = listPartRecordsBySession(connection, session.id)
    const artifacts = listArtifactsBySession(connection, session.id)
    const setupParts = allParts.filter(p => p.turnId === null).sort((a, b) => a.ordinal - b.ordinal)
    const allRounds = listRoundRecordsBySession(connection, session.id)
    const workflowKind = getAnalysisWorkflowKindFromStep(allSteps.find(step => step.stepTypeKey === 'analysis_v2_cursor'))
    const workflowLabel = getAnalysisWorkflowLabel(workflowKind)
    const latestError = getLatestAnalysisDiagnosticSummary(artifacts)

    const turnNodes = turns.map(turn => {
      const turnRounds = allRounds
        .filter(r => r.turnId === turn.id)
        .sort((a, b) => a.roundIndex - b.roundIndex)
      return buildTurnNode(turn, turnRounds, allParts, mode, false)
    })

    const data: Record<string, unknown> = {
      id: session.id,
      title: session.title,
      session_type: session.sessionType,
      compaction_strategy: session.compactionStrategy,
      model: {
        name: session.modelProfileSnapshot.name,
        key: session.modelProfileSnapshot.modelKey,
      },
      context_window: {
        available: session.loadedContextLength ?? null,
        used: deriveContextWindowUsed(turns),
      },
      ...(workflowKind ? { workflow_kind: workflowKind } : {}),
      ...(workflowLabel ? { workflow_label: workflowLabel } : {}),
      ...(latestError ? { latest_error: latestError } : {}),
      setup: buildSetupNode(session.id, setupParts, mode, false),
      steps: steps.map(step => buildStepNode(step, steps, turns, allRounds, allParts, artifacts, mode, false)),
      turns: turnNodes,
    }

    if (session.parentKind !== null && session.parentId !== null) {
      data.parent_ref = { kind: session.parentKind, id: session.parentId }
    }

    if (session.mcpProfileSnapshot) {
      data.mcp = { name: session.mcpProfileSnapshot.name }
    }

    return { status: 'ok', payload: { id: session.id, type: 'session', mode, data } }
  }

  // ─── Setup ─────────────────────────────────────────────────────────────────
  if (parsed.type === 'setup') {
    const session = getSessionRecord(connection, parsed.sessionId)
    if (!session) return { status: 'not_found', message: `Session not found for setup: ${rawId}` }

    const allParts = listPartRecordsBySession(connection, session.id)
    const setupParts = allParts.filter(p => p.turnId === null).sort((a, b) => a.ordinal - b.ordinal)
    const setupId = formatSetupId(session.id)
    const data = buildSetupNode(session.id, setupParts, mode, true)

    return { status: 'ok', payload: { id: setupId, type: 'setup', mode, data } }
  }

  // ─── Turn ──────────────────────────────────────────────────────────────────
  if (parsed.type === 'turn') {
    const turn = getTurnRecord(connection, parsed.raw)
    if (!turn) return { status: 'not_found', message: `Turn not found: ${parsed.raw}` }

    const allParts = listPartRecordsBySession(connection, turn.sessionId)
    const allRounds = listRoundRecordsBySession(connection, turn.sessionId)
      .filter(r => r.turnId === turn.id)
      .sort((a, b) => a.roundIndex - b.roundIndex)

    const data = buildTurnNode(turn, allRounds, allParts, mode, false)

    return { status: 'ok', payload: { id: turn.id, type: 'turn', mode, data } }
  }

  // ─── Step ──────────────────────────────────────────────────────────────────
  if (parsed.type === 'step') {
    const step = getStepRecord(connection, parsed.raw)
    if (!step) return { status: 'not_found', message: `Step not found: ${parsed.raw}` }

    const turns = listTurnRecordsBySession(connection, step.sessionId)
    const rounds = listRoundRecordsBySession(connection, step.sessionId)
    const parts = listPartRecordsBySession(connection, step.sessionId)
    const steps = listStepRecordsBySession(connection, step.sessionId)
    const artifacts = listArtifactsBySession(connection, step.sessionId)
    const data = buildStepNode(step, steps, turns, rounds, parts, artifacts, mode, true)

    return { status: 'ok', payload: { id: step.id, type: 'step', mode, data } }
  }

  // ─── Round ─────────────────────────────────────────────────────────────────
  if (parsed.type === 'round') {
    const round = getRoundRecord(connection, parsed.raw)
    if (!round) return { status: 'not_found', message: `Round not found: ${parsed.raw}` }

    const turn = getTurnRecord(connection, round.turnId)
    if (!turn) return { status: 'not_found', message: `Turn not found for round: ${parsed.raw}` }

    const sessionParts = listPartRecordsBySession(connection, turn.sessionId)
    const roundParts = sessionParts
      .filter(p => p.roundId === round.id && isPublicPartType(p.partType))
      .sort((a, b) => a.ordinal - b.ordinal)

    const toolResultsByParent = buildToolResultIndex(sessionParts)
    const data = buildRoundNode(round, roundParts, toolResultsByParent, mode, true)

    return { status: 'ok', payload: { id: round.id, type: 'round', mode, data } }
  }

  // ─── Part ──────────────────────────────────────────────────────────────────
  const part = getPartRecord(connection, parsed.raw)
  if (!part) return { status: 'not_found', message: `Part not found: ${parsed.raw}` }

  const sessionParts = listPartRecordsBySession(connection, part.sessionId)
  const toolResultsByParent = buildToolResultIndex(sessionParts)

  // If this is a tool-result, redirect to its parent tool-call
  const effectivePart = (part.partType === 'tool-result' && part.parentPartId)
    ? (getPartRecord(connection, part.parentPartId) ?? part)
    : part

  const resultParts = effectivePart.partType === 'tool-call'
    ? (toolResultsByParent.get(effectivePart.id) ?? [])
    : []

  const node = buildPartNode(effectivePart, resultParts, 'full', true, true)
  if (!node) return { status: 'not_found', message: `Part not found: ${parsed.raw}` }

  return { status: 'ok', payload: { id: effectivePart.id, type: 'part', mode: 'full', data: node } }
}
