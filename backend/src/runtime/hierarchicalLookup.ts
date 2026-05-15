import type Database from 'better-sqlite3'
import type { PartRecord, RoundRecord } from '../domain/model.js'
import { parseHierarchicalId } from '../domain/hierarchicalIds.js'
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
    type: 'session' | 'turn' | 'round' | 'part'
    mode: LookupMode
    parentIds: {
      sessionId: string
      turnId: string | null
      roundId: string | null
    }
    data: unknown
  }
}

type LookupFailure =
  | { status: 'invalid'; message: string }
  | { status: 'not_found'; message: string }

export function resolveHierarchicalId(
  connection: Database.Database,
  rawId: string,
  mode: LookupMode,
): LookupSuccess | LookupFailure {
  const parsed = parseHierarchicalId(rawId)
  if (!parsed) {
    return { status: 'invalid', message: `Invalid hierarchical ID: ${rawId}` }
  }

  if (parsed.type === 'session') {
    const session = getSessionRecord(connection, parsed.sessionId)
    if (!session) return { status: 'not_found', message: `Session not found: ${parsed.sessionId}` }

    const turns = listTurnRecordsBySession(connection, session.id)
    return {
      status: 'ok',
      payload: {
        id: session.id,
        type: 'session',
        mode,
        parentIds: { sessionId: session.id, turnId: null, roundId: null },
        data: mode === 'summary'
          ? {
              session: {
                id: session.id,
                title: session.title,
                status: session.status,
                initStatus: session.initStatus,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                isContextExhausted: session.isContextExhausted,
              },
              turns: turns.map(turn => ({
                id: turn.id,
                sequenceNumber: turn.sequenceNumber,
                status: turn.status,
              })),
            }
          : {
              session: {
                id: session.id,
                title: session.title,
                status: session.status,
                initStatus: session.initStatus,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                isContextExhausted: session.isContextExhausted,
                modelProfileName: session.modelProfileSnapshot.name,
                modelKey: session.modelProfileSnapshot.modelKey,
                mcpProfileName: session.mcpProfileSnapshot?.name ?? null,
                loadedContextLength: session.loadedContextLength,
                compactionStrategy: session.compactionStrategy,
              },
              turns: turns.map(turn => ({
                id: turn.id,
                sequenceNumber: turn.sequenceNumber,
                status: turn.status,
                outcome: turn.outcome,
                usage: turn.usage,
                createdAt: turn.createdAt,
                completedAt: turn.completedAt,
              })),
            },
      },
    }
  }

  if (parsed.type === 'turn') {
    const turn = getTurnRecord(connection, parsed.raw)
    if (!turn) return { status: 'not_found', message: `Turn not found: ${parsed.raw}` }
    const session = getSessionRecord(connection, turn.sessionId)
    if (!session) return { status: 'not_found', message: `Session not found: ${turn.sessionId}` }

    const rounds = listRoundRecordsBySession(connection, turn.sessionId)
      .filter(round => round.turnId === turn.id)
    return {
      status: 'ok',
      payload: {
        id: turn.id,
        type: 'turn',
        mode,
        parentIds: { sessionId: turn.sessionId, turnId: turn.id, roundId: null },
        data: mode === 'summary'
          ? {
              turn: {
                id: turn.id,
                sequenceNumber: turn.sequenceNumber,
                status: turn.status,
                outcome: turn.outcome,
              },
              rounds: rounds.map(round => ({
                id: round.id,
                roundIndex: round.roundIndex,
                status: round.status,
                finishReason: round.finishReason,
              })),
            }
          : {
              turn: {
                id: turn.id,
                sequenceNumber: turn.sequenceNumber,
                status: turn.status,
                outcome: turn.outcome,
                usage: turn.usage,
                createdAt: turn.createdAt,
                completedAt: turn.completedAt,
                contextTokensAtTurnEnd: turn.contextTokensAtTurnEnd,
                contextTokensAfterCompaction: turn.contextTokensAfterCompaction,
                compactionApplied: turn.compactionApplied,
                compactionTokensRemoved: turn.compactionTokensRemoved,
              },
              rounds: rounds.map(round => ({
                id: round.id,
                roundIndex: round.roundIndex,
                status: round.status,
                finishReason: round.finishReason,
                startedAt: round.startedAt,
                completedAt: round.completedAt,
                usage: round.usage,
              })),
              session: {
                id: session.id,
                title: session.title,
              },
            },
      },
    }
  }

  if (parsed.type === 'round') {
    const round = getRoundRecord(connection, parsed.raw)
    if (!round) return { status: 'not_found', message: `Round not found: ${parsed.raw}` }
    const turn = getTurnRecord(connection, round.turnId)
    if (!turn) return { status: 'not_found', message: `Turn not found: ${round.turnId}` }
    const parts = listPartRecordsBySession(connection, turn.sessionId)
      .filter(part => part.roundId === round.id)
      .sort((a, b) => a.ordinal - b.ordinal)
    const logicalParts = toLogicalParts(parts)

    return {
      status: 'ok',
      payload: {
        id: round.id,
        type: 'round',
        mode,
        parentIds: { sessionId: turn.sessionId, turnId: turn.id, roundId: round.id },
        data: mode === 'summary'
          ? {
              round: toLookupRound(round),
              parts: logicalParts.map(logical => ({
                id: logical.id,
                kind: logical.kind,
                label: logical.label,
                toolName: logical.toolName,
                tokenCount: logical.tokenCount,
                preview: logical.preview,
              })),
            }
          : {
              round: toLookupRound(round),
              parts: logicalParts.map(logical => logical.full),
            },
      },
    }
  }

  const part = getPartRecord(connection, parsed.raw)
  if (!part) return { status: 'not_found', message: `Part not found: ${parsed.raw}` }
  const sessionParts = listPartRecordsBySession(connection, part.sessionId)
  const logicalPart = toLogicalPart(part, sessionParts)

  return {
    status: 'ok',
    payload: {
      id: part.id,
      type: 'part',
      mode,
      parentIds: {
        sessionId: part.sessionId,
        turnId: part.turnId,
        roundId: part.roundId,
      },
      data: mode === 'summary'
        ? {
            part: {
              id: logicalPart.id,
              kind: logicalPart.kind,
              label: logicalPart.label,
              toolName: logicalPart.toolName,
              tokenCount: logicalPart.tokenCount,
              preview: logicalPart.preview,
              ...(logicalPart.kind === 'setup'
                ? {
                    setupType: logicalPart.setupType,
                    toolCount: logicalPart.toolCount,
                    toolNames: logicalPart.toolNames,
                  }
                : {}),
            },
          }
        : { part: logicalPart.full },
    },
  }
}

function mapPartKind(partType: PartRecord['partType']): 'setup' | 'user_prompt' | 'reasoning' | 'tool_call' | 'assistant_answer' {
  if (partType === 'user-message') return 'user_prompt'
  if (partType === 'assistant-reasoning') return 'reasoning'
  if (partType === 'assistant-content') return 'assistant_answer'
  if (partType === 'tool-call' || partType === 'tool-result') return 'tool_call'
  return 'setup'
}

function toLogicalParts(parts: PartRecord[]) {
  const byId = new Map(parts.map(part => [part.id, part]))
  const toolResultsByParent = new Map<string, PartRecord[]>()
  for (const part of parts) {
    if (part.partType !== 'tool-result' || !part.parentPartId) continue
    toolResultsByParent.set(part.parentPartId, [...(toolResultsByParent.get(part.parentPartId) ?? []), part])
  }

  const logical: ReturnType<typeof toLogicalPart>[] = []
  for (const part of parts) {
    if (part.partType === 'tool-result' && part.parentPartId && byId.has(part.parentPartId)) {
      continue
    }
    logical.push(toLogicalPart(part, parts, toolResultsByParent.get(part.id) ?? []))
  }
  return logical
}

function toLogicalPart(
  part: PartRecord,
  sessionParts: PartRecord[],
  explicitToolResults: PartRecord[] | null = null,
) {
  const kind = mapPartKind(part.partType)
  const setupSummary = kind === 'setup' ? summarizeSetupPart(part) : null
  const toolResults = explicitToolResults
    ?? (part.partType === 'tool-call'
      ? sessionParts.filter(candidate => candidate.partType === 'tool-result' && candidate.parentPartId === part.id)
      : part.partType === 'tool-result' && part.parentPartId
        ? sessionParts.filter(candidate => candidate.id === part.parentPartId || candidate.parentPartId === part.parentPartId)
        : [])
  const toolCall = part.partType === 'tool-result' && part.parentPartId
    ? sessionParts.find(candidate => candidate.id === part.parentPartId) ?? part
    : part
  const toolName = kind === 'tool_call'
    ? String(
        (toolCall.payload.json as { name?: string; toolName?: string } | null)?.name
        ?? (toolCall.payload.json as { name?: string; toolName?: string } | null)?.toolName
        ?? toolCall.payload.summary
        ?? 'unknown',
      )
    : null
  const mergedTokenCount = kind === 'tool_call'
    ? [toolCall, ...toolResults].reduce((sum, candidate) => sum + (candidate.tokens.count ?? 0), 0)
    : (part.tokens.count ?? null)
  const preview = kind === 'tool_call'
    ? toolName
    : part.payload.summary ?? null

  return {
    id: toolCall.id,
    kind,
    label: part.partType,
    toolName,
    tokenCount: mergedTokenCount,
    preview,
    ...(kind === 'setup' && setupSummary
      ? {
          setupType: setupSummary.setupType,
          toolCount: setupSummary.toolCount,
          toolNames: setupSummary.toolNames,
        }
      : {}),
    full: kind === 'tool_call'
      ? {
          id: toolCall.id,
          kind,
          type: toolCall.partType,
          sessionId: toolCall.sessionId,
          turnId: toolCall.turnId,
          roundId: toolCall.roundId,
          tokenCount: mergedTokenCount,
          toolName,
          toolCallPayload: toolCall.payload.json,
          toolResponsePayload: toolResults.map(result => ({
            id: result.id,
            text: result.payload.text,
            json: result.payload.json,
            mimeType: result.payload.mimeType,
          })),
        }
      : kind === 'setup' && setupSummary
        ? {
            id: part.id,
            kind,
            type: part.partType,
            sessionId: part.sessionId,
            turnId: part.turnId,
            roundId: part.roundId,
            tokenCount: part.tokens.count,
            preview,
            setupType: setupSummary.setupType,
            summary: setupSummary.summary,
            toolCount: setupSummary.toolCount,
            toolNames: setupSummary.toolNames,
          }
      : {
          id: part.id,
          kind,
          type: part.partType,
          sessionId: part.sessionId,
          turnId: part.turnId,
          roundId: part.roundId,
          tokenCount: part.tokens.count,
          content: {
            text: part.payload.text,
            json: part.payload.json,
            mimeType: part.payload.mimeType,
            summary: part.payload.summary,
          },
        },
  }
}

function summarizeSetupPart(part: PartRecord) {
  const toolNames = part.partType === 'tool-definitions' && Array.isArray(part.payload.json)
    ? part.payload.json
      .map((value) => {
        if (!value || typeof value !== 'object' || !('name' in value)) return null
        return typeof value.name === 'string' ? value.name : null
      })
      .filter((name): name is string => name !== null)
    : []

  return {
    setupType: part.partType,
    summary: part.payload.summary ?? part.context.note ?? null,
    toolCount: part.partType === 'tool-definitions' ? toolNames.length : null,
    toolNames: part.partType === 'tool-definitions' ? toolNames : null,
  }
}

function toLookupRound(round: RoundRecord) {
  return {
    id: round.id,
    roundIndex: round.roundIndex,
    status: round.status,
    finishReason: round.finishReason,
    startedAt: round.startedAt,
    completedAt: round.completedAt,
    usage: round.usage,
  }
}
