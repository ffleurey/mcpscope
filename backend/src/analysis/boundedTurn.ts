/**
 * Bounded LLM turn runner for analysis v2.
 *
 * Runs a single, tool-free LLM call using an explicit message array (bypassing
 * buildModelMessages entirely) and persists the resulting turn + round + parts
 * records to the database.
 *
 * Returns the response text and IDs for subsequent context-mutation steps.
 */

import crypto from 'node:crypto'
import {
  formatTurnId,
  formatRoundId,
  formatPartId,
} from '../domain/hierarchicalIds.js'
import type { BackendDatabase } from '../persistence/db.js'
import type { LmStudioGateway } from '../runtime/modelTurns.js'
import {
  insertTurnRecord,
  updateTurnRecord,
  insertRoundRecord,
  updateRoundRecord,
  insertPartRecord,
  insertRawExchangeRecord,
  getNextTurnSequenceNumber,
  getNextPartOrdinal,
} from '../persistence/repository.js'
import type { TurnRecord, RoundRecord, PartRecord } from '../domain/model.js'
import { executeChatCompletion } from '../runtime/streamedCompletion.js'

export interface AnalysisMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface BoundedTurnResult {
  turnId: string
  roundId: string
  userPartId: string
  responseText: string
}

function now(): number {
  return Date.now()
}

function uuid(): string {
  return crypto.randomUUID()
}

function normalizeLmUsage(completion: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null }) {
  const usage = completion.usage
  return {
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    reasoningTokens: null,
    totalTokens: usage?.total_tokens ?? null,
  }
}

/**
 * Runs a single bounded (tool-free) LLM call for the analysis session and
 * persists the turn/round/parts to the database.
 *
 * `messages` should include the complete conversation context for this call.
 * The last message MUST be a user-role message (the assessment prompt).
 */
export async function runBoundedAnalysisTurn(
  database: BackendDatabase,
  lmGateway: LmStudioGateway,
  analysisSession: { id: string; modelProfileSnapshot: { connectionBaseUrl: string; modelKey: string; apiKey?: string | null } },
  messages: AnalysisMessage[],
): Promise<BoundedTurnResult> {
  const startedAt = now()
  const sessionId = analysisSession.id
  const turnSequenceNumber = getNextTurnSequenceNumber(database.connection, sessionId)
  const turnId = formatTurnId(sessionId, turnSequenceNumber)
  const roundId = formatRoundId(sessionId, turnSequenceNumber, 1)

  // The last message must be the user prompt for this turn
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg || lastMsg.role !== 'user') {
    throw new Error('Last message in bounded analysis turn must be a user message')
  }
  const userContent = lastMsg.content

  const userPartOrdinal = getNextPartOrdinal(database.connection, sessionId)
  // We need a stable part number for the user part; use turnSequence + 1
  const userPartId = formatPartId(sessionId, turnSequenceNumber, 1, 1, 'user-message')

  const userPart: PartRecord = {
    id: userPartId,
    sessionId,
    turnId,
    roundId,
    parentPartId: null,
    ordinal: userPartOrdinal,
    partType: 'user-message',
    roleLabel: 'user',
    payload: {
      text: userContent,
      json: null,
      mimeType: 'text/plain',
      summary: null,
    },
    display: { state: 'transcript', collapsedByDefault: false },
    context: {
      state: 'included',
      note: null,
      strippedByCompactionAtTurnId: null,
    },
    tokens: { count: null, source: 'unknown', confidence: 'unknown', note: null },
    provenanceJson: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  }

  const turn: TurnRecord = {
    id: turnId,
    sessionId,
    sequenceNumber: turnSequenceNumber,
    status: 'streaming',
    outcome: null,
    usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
    contextTokensAtTurnEnd: null,
    contextTokensAfterCompaction: null,
    compactionApplied: 'none',
    compactionTokensRemoved: null,
    createdAt: startedAt,
    completedAt: null,
  }

  const round: RoundRecord = {
    id: roundId,
    turnId,
    roundIndex: 1,
    status: 'streaming',
    finishReason: null,
    usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
    requestPayloadJson: null,
    responseTraceJson: null,
    startedAt,
    completedAt: null,
  }

  const persistInitial = database.connection.transaction(() => {
    insertTurnRecord(database.connection, turn)
    insertRoundRecord(database.connection, round)
    insertPartRecord(database.connection, userPart)
  })
  persistInitial()

  const requestBody: Record<string, unknown> = {
    model: analysisSession.modelProfileSnapshot.modelKey,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: false,
  }

  const streamedResult = await executeChatCompletion(
    lmGateway,
    analysisSession.modelProfileSnapshot.connectionBaseUrl,
    analysisSession.modelProfileSnapshot.apiKey ?? undefined,
    requestBody,
  )

  const completedAt = now()
  const completion = streamedResult.completion
  const usage = normalizeLmUsage(completion)

  turn.status = 'complete'
  turn.completedAt = completedAt
  turn.outcome = 'model-response'
  turn.usage = usage

  round.status = 'complete'
  round.finishReason = 'stop'
  round.completedAt = completedAt
  round.usage = usage
  round.requestPayloadJson = requestBody
  round.responseTraceJson = {
    completion,
    assistantSegments: streamedResult.segments,
  }

  // Collect response text from segments
  const responseText = streamedResult.segments
    .filter(s => s.kind === 'content' || s.kind === 'reasoning')
    .map(s => ('text' in s ? (s.text ?? '') : ''))
    .join('')
    .trim()

  // Build assistant parts from segments
  const assistantParts: PartRecord[] = []
  let nextOrdinal = userPartOrdinal + 1
  let nextPartNum = 2
  for (const segment of streamedResult.segments) {
    if (segment.kind === 'reasoning' && 'text' in segment && segment.text?.trim()) {
      assistantParts.push({
        id: formatPartId(sessionId, turnSequenceNumber, 1, nextPartNum++, 'assistant-reasoning'),
        sessionId,
        turnId,
        roundId,
        parentPartId: null,
        ordinal: nextOrdinal++,
        partType: 'assistant-reasoning',
        roleLabel: 'assistant',
        payload: { text: segment.text.trim(), json: null, mimeType: 'text/plain', summary: null },
        display: { state: 'transcript', collapsedByDefault: true },
        context: {
          state: 'included',
          note: null,
          strippedByCompactionAtTurnId: null,
        },
        tokens: { count: null, source: 'unknown', confidence: 'unknown', note: null },
        provenanceJson: null,
        createdAt: completedAt,
        updatedAt: completedAt,
      })
    } else if (segment.kind === 'content' && 'text' in segment && segment.text?.trim()) {
      assistantParts.push({
        id: formatPartId(sessionId, turnSequenceNumber, 1, nextPartNum++, 'assistant-content'),
        sessionId,
        turnId,
        roundId,
        parentPartId: null,
        ordinal: nextOrdinal++,
        partType: 'assistant-content',
        roleLabel: 'assistant',
        payload: { text: segment.text.trim(), json: null, mimeType: 'text/plain', summary: null },
        display: { state: 'transcript', collapsedByDefault: false },
        context: {
          state: 'included',
          note: null,
          strippedByCompactionAtTurnId: null,
        },
        tokens: { count: null, source: 'unknown', confidence: 'unknown', note: null },
        provenanceJson: null,
        createdAt: completedAt,
        updatedAt: completedAt,
      })
    }
  }

  const rawReqExchange = {
    id: uuid(),
    sessionId,
    turnId,
    roundId,
    kind: 'lmstudio-request' as const,
    requestUrl: `${analysisSession.modelProfileSnapshot.connectionBaseUrl.replace(/\/$/, '')}/chat/completions`,
    requestMethod: 'POST',
    requestHeadersJson: { 'content-type': 'application/json' },
    requestBody: JSON.stringify(requestBody),
    responseStatus: 200,
    responseHeadersJson: null,
    responseBody: null,
    createdAt: startedAt,
  }
  const rawRespExchange = {
    id: uuid(),
    sessionId,
    turnId,
    roundId,
    kind: 'lmstudio-response' as const,
    requestUrl: rawReqExchange.requestUrl,
    requestMethod: 'POST',
    requestHeadersJson: null,
    requestBody: null,
    responseStatus: 200,
    responseHeadersJson: null,
    responseBody: streamedResult.rawResponseBody,
    createdAt: completedAt,
  }

  const persistComplete = database.connection.transaction(() => {
    updateTurnRecord(database.connection, turn)
    updateRoundRecord(database.connection, round)
    for (const part of assistantParts) {
      insertPartRecord(database.connection, part)
    }
    insertRawExchangeRecord(database.connection, rawReqExchange)
    insertRawExchangeRecord(database.connection, rawRespExchange)
  })
  persistComplete()

  return { turnId, roundId, userPartId, responseText }
}
