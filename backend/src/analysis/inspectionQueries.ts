/**
 * Tree-loading queries for analysis session traversal.
 *
 * Reads a target session's runtime tree directly from SQLite into the hook
 * context types defined by the abstract base class.  Runs in-process via
 * the existing repository functions — no MCP loop.
 */

import type { BackendConnection } from "../persistence/connection.js";
import {
  getSessionRecord,
  listStepRecordsBySession,
  listTurnRecordsBySession,
  listRoundRecordsBySession,
  listPartRecordsBySession,
} from '../persistence/repositoryRuntime.js'
import type { StepRecord, TurnRecord, RoundRecord, PartRecord } from '../domain/model.js'
import type {
  SessionInfo,
  SetupInfo,
  PartInfo,
  StepInfo,
  TurnInfo,
  RoundInfo,
  CompactionInfo,
  SessionTree,
} from './analysisSessionBase.js'

// ─────────────────────────────────────────────────────────────────────────────
// DB part-type → canonical hook part-type
// ─────────────────────────────────────────────────────────────────────────────

const PART_TYPE_MAP: Record<string, PartInfo['type']> = {
  'system_prompt':         'system_prompt',
  'system-prompt':         'system_prompt',
  'mcp_instructions':      'mcp_instructions',
  'mcp-instructions':      'mcp_instructions',
  'tool_definitions':      'tool_definitions',
  'tool-definitions':      'tool_definitions',
  'user_prompt':           'user_prompt',
  'user-message':          'user_prompt',
  'reasoning':             'reasoning',
  'assistant-reasoning':   'reasoning',
  'tool_call':             'tool_call',
  'tool-call':              'tool_call',
  'assistant_answer':      'assistant_answer',
  'assistant-content':     'assistant_answer',
}

function toHookPartType(raw: string): PartInfo['type'] {
  return PART_TYPE_MAP[raw] ?? 'assistant_answer'
}

function partRecordToPartInfo(p: PartRecord): PartInfo {
  const info: Record<string, unknown> = {
    id: p.id,
    type: toHookPartType(p.partType),
    tokenCount: p.tokens.count,
    contextState: p.context.state,
  }
  if (p.payload.text) {
    info.content = { text: p.payload.text }
  } else if (p.payload.json) {
    info.content = { json: p.payload.json }
  }
  return info as unknown as PartInfo
}

function partRecordToToolCallPartInfo(p: PartRecord): PartInfo {
  const payload = p.payload.json as { name?: string; arguments?: unknown } | undefined
  const info: Record<string, unknown> = {
    id: p.id,
    type: toHookPartType(p.partType),
    tokenCount: p.tokens.count,
    contextState: p.context.state,
  }
  if (payload?.name) {
    info.toolName = payload.name
  }
  if (payload) {
    info.toolPayload = { call: payload }
  }
  if (p.payload.text) {
    info.content = { text: p.payload.text }
  } else if (p.payload.json) {
    info.content = { json: p.payload.json }
  }
  return info as unknown as PartInfo
}

// ─────────────────────────────────────────────────────────────────────────────
// Step classification helpers
// ─────────────────────────────────────────────────────────────────────────────

const TURN_STEP_TYPES = new Set(['turn'])
const COMPACTION_STEP_TYPES = new Set(['compaction'])

function classifyStep(step: StepRecord): { isTurn: boolean; isCompaction: boolean; isWorkflowStep: boolean } {
  const key = step.stepTypeKey as string
  return {
    isTurn: TURN_STEP_TYPES.has(key),
    isCompaction: COMPACTION_STEP_TYPES.has(key),
    isWorkflowStep: !TURN_STEP_TYPES.has(key) && !COMPACTION_STEP_TYPES.has(key),
  }
}

function stepRecordToStepInfo(step: StepRecord): StepInfo {
  const classification = classifyStep(step)
  return {
    id: step.id,
    type: step.stepTypeKey as string,
    status: step.status,
    childIndex: step.childIndex,
    ...classification,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree loading
// ─────────────────────────────────────────────────────────────────────────────

function buildSetupInfo(parts: PartRecord[]): SetupInfo | null {
  const setupParts = parts.filter(p => !p.turnId && !p.roundId)
  if (setupParts.length === 0) return null

  return {
    id: `${parts[0]?.sessionId ?? '?'}.S`,
    parts: setupParts.map(partRecordToPartInfo),
  }
}

function buildTurnDetails(
  steps: StepRecord[],
  turns: TurnRecord[],
  rounds: RoundRecord[],
  parts: PartRecord[],
): Map<string, TurnInfo> {
  const result = new Map<string, TurnInfo>()

  const roundMap = new Map<string, RoundRecord[]>()
  for (const r of rounds) {
    const list = roundMap.get(r.turnId) ?? []
    list.push(r)
    roundMap.set(r.turnId, list)
  }

  const partMap = new Map<string, PartRecord[]>()
  for (const p of parts) {
    if (!p.roundId) continue
    const key = `${p.turnId}|${p.roundId}`
    const list = partMap.get(key) ?? []
    list.push(p)
    partMap.set(key, list)
  }

  const turnSteps = steps.filter(s => classifyStep(s).isTurn)

  for (const step of turnSteps) {
    const turn = turns.find(t => t.id === step.id)
    if (!turn) continue

    const turnRounds = roundMap.get(turn.id) ?? []
    const roundInfos: RoundInfo[] = turnRounds
      .sort((a, b) => a.roundIndex - b.roundIndex)
      .map(r => {
        const roundParts = (partMap.get(`${turn.id}|${r.id}`) ?? [])
          .sort((a, b) => a.ordinal - b.ordinal)

        // For tool_call parts, enrich with tool name / payload
        const partInfos: PartInfo[] = roundParts.map(p =>
          p.partType === 'tool-call'
            ? partRecordToToolCallPartInfo(p)
            : partRecordToPartInfo(p),
        )

        return {
          id: r.id,
          index: r.roundIndex,
          status: r.status,
          parts: partInfos,
        }
      })

    result.set(step.id, {
      id: turn.id,
      step: stepRecordToStepInfo(step),
      turnNumber: turn.turnNumber,
      ownerStepId: turn.ownerStepId ?? null,
      rounds: roundInfos,
    })
  }

  return result
}

function buildCompactionDetails(
  steps: StepRecord[],
  parts: PartRecord[],
): Map<string, CompactionInfo> {
  const result = new Map<string, CompactionInfo>()
  const compactionSteps = steps.filter(s => classifyStep(s).isCompaction)

  const strippedPartIds = new Map<string, string[]>()
  for (const p of parts) {
    const compactionStepId = p.context.strippedByCompactionAtTurnId
    if (compactionStepId) {
      const list = strippedPartIds.get(compactionStepId) ?? []
      list.push(p.id)
      strippedPartIds.set(compactionStepId, list)
    }
  }

  for (const step of compactionSteps) {
    const params = step.params as Record<string, unknown>
    result.set(step.id, {
      step: stepRecordToStepInfo(step),
      strategy: (params.strategy ?? null) as string | null,
      strippedPartIds: strippedPartIds.get(step.id) ?? [],
      strippedPartCount: (strippedPartIds.get(step.id) ?? []).length,
      contextTokensBefore: (step.state.contextTokensBefore as number | null) ?? null,
      contextTokensAfter: (step.state.contextTokensAfter as number | null) ?? null,
      tokensRemoved: (step.state.tokensRemoved as number | null) ?? null,
    })
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function loadSessionTree(
  connection: BackendConnection,
  sessionId: string,
): SessionTree | null {
  const sessionRecord = getSessionRecord(connection, sessionId)
  if (!sessionRecord) return null

  const session: SessionInfo = {
    id: sessionRecord.id,
    title: sessionRecord.title,
    status: sessionRecord.status,
    model: {
      name: sessionRecord.modelProfileSnapshot.name,
      key: sessionRecord.modelProfileSnapshot.modelKey ?? sessionRecord.modelProfileSnapshot.name,
    },
    contextWindow: {
      available: sessionRecord.loadedContextLength,
      used: null,
    },
  }

  const steps = listStepRecordsBySession(connection, sessionId) as unknown as StepRecord[]

  const turns = listTurnRecordsBySession(connection, sessionId) as unknown as TurnRecord[]
  const rounds = listRoundRecordsBySession(connection, sessionId) as unknown as RoundRecord[]
  const parts = listPartRecordsBySession(connection, sessionId) as unknown as PartRecord[]

  const setup = buildSetupInfo(parts)
  const stepInfos = steps.map(stepRecordToStepInfo)
  const turnDetails = buildTurnDetails(steps, turns, rounds, parts)
  const compactionDetails = buildCompactionDetails(steps, parts)

  return { session, setup, steps: stepInfos, turnDetails, compactionDetails }
}
