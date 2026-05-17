import type Database from 'better-sqlite3'
import type { PartRecord, RoundRecord, TurnRecord } from '../domain/model.js'
import { formatSetupId, parseHierarchicalId } from '../domain/hierarchicalIds.js'
import {
  getPartRecord,
  getRoundRecord,
  getSessionRecord,
  getTurnRecord,
  listPartRecordsBySession,
  listRoundRecordsBySession,
  listTurnRecordsBySession,
} from '../persistence/repository.js'

type LookupMode = 'summary' | 'full'

type LookupSuccess = {
  status: 'ok'
  payload: {
    id: string
    type: 'session' | 'setup' | 'turn' | 'round' | 'part'
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
  return partType !== 'diagnostic-note' && partType !== 'tool-result'
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
    number: turn.sequenceNumber,
    ...(turn.status ? { status: turn.status } : {}),
    rounds: roundNodes,
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
    const allParts = listPartRecordsBySession(connection, session.id)
    const setupParts = allParts.filter(p => p.turnId === null).sort((a, b) => a.ordinal - b.ordinal)
    const allRounds = listRoundRecordsBySession(connection, session.id)

    const turnNodes = turns.map(turn => {
      const turnRounds = allRounds
        .filter(r => r.turnId === turn.id)
        .sort((a, b) => a.roundIndex - b.roundIndex)
      return buildTurnNode(turn, turnRounds, allParts, mode, false)
    })

    const data: Record<string, unknown> = {
      id: session.id,
      title: session.title,
      compaction_strategy: session.compactionStrategy,
      model: {
        name: session.modelProfileSnapshot.name,
        key: session.modelProfileSnapshot.modelKey,
      },
      context_window: {
        available: session.loadedContextLength ?? null,
        used: deriveContextWindowUsed(turns),
      },
      setup: buildSetupNode(session.id, setupParts, mode, false),
      turns: turnNodes,
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
