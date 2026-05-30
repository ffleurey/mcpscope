import type { BackendDatabase } from '../persistence/db.js'
import {
  createSessionRecord,
  getNextPreludePartSequence,
  getNextRoundPartSequence,
  getNextPartOrdinal,
  getNextTurnSequenceNumber,
  getSessionRecord,
  insertPartRecord,
  insertRawExchangeRecord,
  insertRoundRecord,
  insertTurnRecord,
  listPartRecordsBySession,
  listRawExchangeRecordsBySession,
  listRoundRecordsBySession,
  listTurnRecordsBySession,
  updatePartRecord,
  updateRoundRecord,
  updateSessionRecord,
  updateTurnRecord,
} from '../persistence/repository.js'
import {
  formatPartId,
  formatRoundId,
  formatTurnId,
  generateUniqueSessionId,
  isValidSessionId,
} from '../domain/hierarchicalIds.js'
import type {
  McpProfileSnapshot,
  ModelProfileSnapshot,
  ParentKind,
  PartRecord,
  RoundRecord,
  SessionRecord,
  SessionType,
  TurnRecord,
} from '../domain/model.js'
import { deriveContextEntries, deriveTranscriptEntries, buildModelMessages } from '../domain/selectors.js'
import type {
  LmStudioChatCompletionResponse,
  LmStudioPromptProbeResult,
  LmStudioStreamCallbacks,
  LmStudioStreamedChatCompletionResult,
} from '../services/lmstudio/client.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import {
  allocateProportionalTokenCounts,
  deriveExactDeltaTokenMetadata,
  normalizeLmStudioUsageFromResponse,
} from '../domain/tokenAccounting.js'
import { createSystemPromptPart, ensureSessionPreludeTokenMetadata } from './sessionPrelude.js'
import { probeRequestPromptTokens } from './promptTokenProbing.js'
import { executeChatCompletion } from './streamedCompletion.js'
import type { TurnStreamEventSink } from './streamEvents.js'
import { applyContextCompaction } from '../domain/compaction.js'
import { DEFAULT_SESSION_TITLE, maybeApplyAutomaticSessionTitle } from './sessionTitles.js'

export interface LmStudioGateway {
  createChatCompletion(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<LmStudioChatCompletionResponse>
  streamChatCompletion?(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
    callbacks?: LmStudioStreamCallbacks,
  ): Promise<LmStudioStreamedChatCompletionResult>
  probePromptTokens?(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<number | null>
  probePromptTokensDetailed?(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<LmStudioPromptProbeResult>
  getLoadedContextLength?(
    baseUrl: string,
    apiKey: string | undefined,
    modelKey: string,
  ): Promise<number | null>
}

export interface CreateSessionInput {
  sessionId?: string | undefined
  title?: string | undefined
  modelProfileSnapshot: ModelProfileSnapshot
  mcpProfileSnapshot?: McpProfileSnapshot | null | undefined
  compactionStrategy?: 'none' | 'strip-reasoning' | undefined
  /** Session type. Defaults to 'primary' when omitted. */
  sessionType?: SessionType | undefined
  /** Parent object kind. Must be provided together with parentId. */
  parentKind?: ParentKind | null | undefined
  /** Parent object id. Must be provided together with parentKind. */
  parentId?: string | null | undefined
}

export interface CreateTurnInput {
  sessionId: string
  userContent: string
  reservedTurn?: TurnRecord | undefined
}

export interface RuntimeTurnResult {
  session: SessionRecord
  turn: TurnRecord
  round: RoundRecord
  rounds: RoundRecord[]
  parts: PartRecord[]
  transcript: ReturnType<typeof deriveTranscriptEntries>
  context: ReturnType<typeof deriveContextEntries>
}

export class SessionIdInputError extends Error {}
export class SessionIdConflictError extends Error {}
export class SessionIdGenerationError extends Error {}

type SegmentTokenMetadata = {
  count: number | null
  source: PartRecord['tokens']['source']
  confidence: PartRecord['tokens']['confidence']
  note: string | null
  provenanceJson: unknown
}

function normalizeSegmentText(text: string): string | null {
  return text.trim().length > 0 ? text : null
}

function createUuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export function createSession(
  database: BackendDatabase,
  input: CreateSessionInput,
): SessionRecord {
  const timestamp = now()
  const explicitSessionId = input.sessionId?.trim().toUpperCase()
  if (explicitSessionId && !isValidSessionId(explicitSessionId)) {
    throw new SessionIdInputError('Session ID must be 4 uppercase characters from A-Z and 2-9, excluding O, I, 0, 1')
  }

  const sessionId = explicitSessionId
    ?? generateUniqueSessionId(
      candidate => getSessionRecord(database.connection, candidate) !== null,
      3,
    )

  if (sessionId == null) {
    throw new SessionIdGenerationError('Could not generate a unique session ID after 3 attempts')
  }

  if (getSessionRecord(database.connection, sessionId) !== null) {
    throw new SessionIdConflictError(`Session ID already exists: ${sessionId}`)
  }

  const session: SessionRecord = {
    id: sessionId,
    title: input.title?.trim() || DEFAULT_SESSION_TITLE,
    status: 'ready',
    initStatus: 'pending',
    sessionType: input.sessionType ?? 'primary',
    parentKind: input.parentKind ?? null,
    parentId: input.parentId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    modelProfileSnapshot: input.modelProfileSnapshot,
    mcpProfileSnapshot: input.mcpProfileSnapshot ?? null,
    loadedContextLength: null,
    systemPromptTokens: null,
    toolDefinitionsTokens: null,
    isContextExhausted: false,
    compactionStrategy: input.compactionStrategy ?? 'strip-reasoning',
  }

  const tx = database.connection.transaction(() => {
    createSessionRecord(database.connection, session)
    const systemPromptPart = createSystemPromptPart(
      session,
      getNextPartOrdinal(database.connection, session.id),
      getNextPreludePartSequence(database.connection, session.id),
      timestamp,
    )
    if (systemPromptPart) {
      insertPartRecord(database.connection, systemPromptPart)
    }
  })
  tx()

  return session
}

export async function createModelOnlyTurn(
  database: BackendDatabase,
  lmStudioGateway: LmStudioGateway,
  input: CreateTurnInput,
  emitEvent?: TurnStreamEventSink,
): Promise<RuntimeTurnResult> {
  const session = getSessionRecord(database.connection, input.sessionId)
  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  const existingParts = await ensureSessionPreludeTokenMetadata(
    database,
    lmStudioGateway,
    session,
    listPartRecordsBySession(database.connection, session.id),
  )
  const requestMessages = buildModelMessages(session, existingParts, input.userContent)
  const startedAt = input.reservedTurn?.createdAt ?? now()
  const turnSequenceNumber = input.reservedTurn?.sequenceNumber
    ?? getNextTurnSequenceNumber(database.connection, session.id)
  const turnId = input.reservedTurn?.id
    ?? formatTurnId(session.id, turnSequenceNumber)
  const roundId = formatRoundId(session.id, turnSequenceNumber, 1)
  const turn: TurnRecord = input.reservedTurn
    ? { ...input.reservedTurn }
    : {
        id: turnId,
        sessionId: session.id,
        sequenceNumber: turnSequenceNumber,
        status: 'streaming',
        createdAt: startedAt,
        completedAt: null,
        outcome: null,
        usage: {
          promptTokens: null,
          completionTokens: null,
          reasoningTokens: null,
          totalTokens: null,
        },
        contextTokensAtTurnEnd: null,
        contextTokensAfterCompaction: null,
        compactionApplied: null,
        compactionTokensRemoved: null,
      }
  const round: RoundRecord = {
    id: roundId,
    turnId,
    roundIndex: 0,
    status: 'streaming',
    finishReason: null,
    startedAt,
    completedAt: null,
    usage: {
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
    requestPayloadJson: null,
    responseTraceJson: null,
  }

  const requestBody = {
    model: session.modelProfileSnapshot.modelKey,
    temperature: session.modelProfileSnapshot.temperature,
    stream: true,
    stream_options: {
      include_usage: true,
    },
    messages: requestMessages,
    ...(session.modelProfileSnapshot.reasoning ? { reasoning: session.modelProfileSnapshot.reasoning } : {}),
  }

  const initialOrdinal = getNextPartOrdinal(database.connection, session.id)
  const initialPartNumber = getNextRoundPartSequence(database.connection, roundId)
  const userPart: PartRecord = {
    id: formatPartId(session.id, turnSequenceNumber, 1, initialPartNumber, 'user-message'),
    sessionId: session.id,
    turnId,
    roundId,
    parentPartId: null,
    ordinal: initialOrdinal,
    partType: 'user-message',
    roleLabel: 'user',
    payload: {
      text: input.userContent,
      json: null,
      mimeType: null,
      summary: null,
    },
    display: {
      state: 'transcript',
      collapsedByDefault: false,
    },
    context: {
      state: 'included',
      note: null,
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: 'Prompt split not derived yet',
    },
    provenanceJson: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  }

  const persistInitialState = database.connection.transaction(() => {
    if (!input.reservedTurn) {
      insertTurnRecord(database.connection, turn)
    }
    insertRoundRecord(database.connection, round)
    insertPartRecord(database.connection, userPart)
  })
  persistInitialState()
  emitEvent?.({
    type: 'turn-started',
    turn: { ...turn },
  })
  emitEvent?.({
    type: 'round-started',
    round: { ...round },
  })

  const streamedCompletion = await executeChatCompletion(
    lmStudioGateway,
    session.modelProfileSnapshot.connectionBaseUrl,
    session.modelProfileSnapshot.apiKey ?? undefined,
    requestBody,
    {
      onDelta(delta) {
        emitEvent?.({
          type: 'part-delta',
          turnId,
          roundId,
          delta,
        })
      },
    },
  )
  const completion = streamedCompletion.completion

  const completedAt = now()
  const finishReason = completion.choices[0]?.finish_reason
  if (finishReason !== 'stop') {
    throw new Error(`Unsupported finish reason for model-only pipeline: ${finishReason ?? 'unknown'}`)
  }

  const usage = normalizeLmStudioUsageFromResponse(completion)

  turn.status = 'complete'
  turn.completedAt = completedAt
  turn.outcome = 'model-response'
  turn.usage = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
  }

  round.status = 'complete'
  round.finishReason = 'stop'
  round.completedAt = completedAt
  round.usage = { ...turn.usage }
  round.requestPayloadJson = requestBody
  round.responseTraceJson = {
    completion,
    assistantSegments: streamedCompletion.segments,
  }

  const reasoningSegments = streamedCompletion.segments
    .filter((segment): segment is { kind: 'reasoning'; text: string } => segment.kind === 'reasoning')
    .map(segment => normalizeSegmentText(segment.text))
    .filter((text): text is string => text !== null)
  const contentSegments = streamedCompletion.segments
    .filter((segment): segment is { kind: 'content'; text: string } => segment.kind === 'content')
    .map(segment => normalizeSegmentText(segment.text))
    .filter((text): text is string => text !== null)

  const reasoningTokenMetadata: SegmentTokenMetadata[] = reasoningSegments.length === 0
    ? []
    : (
        usage.reasoningTokens == null
          ? reasoningSegments.map(() => ({
              count: null,
              source: 'unknown' as const,
              confidence: 'unknown' as const,
              note: 'Reasoning token count was not returned by the backend',
              provenanceJson: null,
            }))
          : reasoningSegments.length === 1
            ? [{
                count: usage.reasoningTokens,
                source: 'exact-api' as const,
                confidence: 'exact' as const,
                note: null,
                provenanceJson: { derivedFrom: 'completion.usage.reasoning_tokens' },
              }]
            : []
      )
  const assistantContentTokenMetadata: SegmentTokenMetadata[] = contentSegments.length === 0
    ? []
    : (
        usage.assistantContentTokens == null
          ? contentSegments.map(() => ({
              count: null,
              source: 'unknown' as const,
              confidence: 'unknown' as const,
              note: 'Completion usage not returned by the backend',
              provenanceJson: null,
            }))
          : contentSegments.length === 1
            ? [{
                count: usage.assistantContentTokens,
                source: 'exact-api' as const,
                confidence: 'exact' as const,
                note: null,
                provenanceJson: { derivedFrom: 'completion.usage.completion_tokens - completion.usage.reasoning_tokens' },
              }]
            : []
      )

  if (reasoningSegments.length > 1) {
    const counts = allocateProportionalTokenCounts(
      usage.reasoningTokens ?? 0,
      reasoningSegments.map(text => Math.max(1, text.length)),
    )
    reasoningTokenMetadata.splice(0, reasoningTokenMetadata.length, ...counts.map(count => ({
      count,
      source: 'estimated' as const,
      confidence: 'estimated' as const,
      note: 'Allocated proportionally from the exact round reasoning token total',
      provenanceJson: {
        derivedFrom: 'completion.usage.reasoning_tokens',
        allocation: 'proportional-by-payload',
      },
    })))
  }

  if (contentSegments.length > 1) {
    const counts = allocateProportionalTokenCounts(
      usage.assistantContentTokens ?? 0,
      contentSegments.map(text => Math.max(1, text.length)),
    )
    assistantContentTokenMetadata.splice(0, assistantContentTokenMetadata.length, ...counts.map(count => ({
      count,
      source: 'estimated' as const,
      confidence: 'estimated' as const,
      note: 'Allocated proportionally from the exact assistant content token total',
      provenanceJson: {
        derivedFrom: 'completion.usage.completion_tokens - completion.usage.reasoning_tokens',
        allocation: 'proportional-by-payload',
      },
    })))
  }

  const assistantParts: PartRecord[] = []
  let nextOrdinal = initialOrdinal + 1
  let nextPartNumber = initialPartNumber + 1

  for (const segment of streamedCompletion.segments) {
    if (segment.kind === 'reasoning') {
      const text = normalizeSegmentText(segment.text)
      if (!text) {
        continue
      }
      const tokenMetadata = reasoningTokenMetadata.shift()
      assistantParts.push({
        id: formatPartId(session.id, turnSequenceNumber, 1, nextPartNumber++, 'assistant-reasoning'),
        sessionId: session.id,
        turnId,
        roundId,
        parentPartId: null,
        ordinal: nextOrdinal++,
        partType: 'assistant-reasoning',
        roleLabel: 'assistant',
        payload: {
          text,
          json: null,
          mimeType: 'text/plain',
          summary: null,
        },
        display: {
          state: 'transcript',
          collapsedByDefault: true,
        },
        context: {
          state: 'included',
          note: 'Reasoning preserved in context for this turn; compaction will strip it after turn completion',
          strippedByCompactionAtTurnId: null,
        },
        tokens: {
          count: tokenMetadata?.count ?? null,
          source: tokenMetadata?.source ?? 'unknown',
          confidence: tokenMetadata?.confidence ?? 'unknown',
          note: tokenMetadata?.note ?? null,
        },
        provenanceJson: tokenMetadata?.provenanceJson ?? null,
        createdAt: completedAt,
        updatedAt: completedAt,
      })
      continue
    }

    if (segment.kind === 'content') {
      const text = normalizeSegmentText(segment.text)
      if (!text) {
        continue
      }
      const tokenMetadata = assistantContentTokenMetadata.shift()
      assistantParts.push({
        id: formatPartId(session.id, turnSequenceNumber, 1, nextPartNumber++, 'assistant-content'),
        sessionId: session.id,
        turnId,
        roundId,
        parentPartId: null,
        ordinal: nextOrdinal++,
        partType: 'assistant-content',
        roleLabel: 'assistant',
        payload: {
          text,
          json: null,
          mimeType: 'text/plain',
          summary: null,
        },
        display: {
          state: 'transcript',
          collapsedByDefault: false,
        },
        context: {
          state: 'included',
          note: 'Assistant answer remains part of later model-visible history',
          strippedByCompactionAtTurnId: null,
        },
        tokens: {
          count: tokenMetadata?.count ?? null,
          source: tokenMetadata?.source ?? 'unknown',
          confidence: tokenMetadata?.confidence ?? 'unknown',
          note: tokenMetadata?.note ?? null,
        },
        provenanceJson: tokenMetadata?.provenanceJson ?? null,
        createdAt: completedAt,
        updatedAt: completedAt,
      })
    }
  }

  const rawRequestExchange = {
    id: createUuid(),
    sessionId: session.id,
    turnId,
    roundId,
    kind: 'lmstudio-request' as const,
    requestUrl: `${session.modelProfileSnapshot.connectionBaseUrl.replace(/\/$/, '')}/chat/completions`,
    requestMethod: 'POST',
    requestHeadersJson: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    requestBody: JSON.stringify(requestBody),
    responseStatus: 200,
    responseHeadersJson: null,
    responseBody: null,
    createdAt: startedAt,
  }

  const rawResponseExchange = {
    id: createUuid(),
    sessionId: session.id,
    turnId,
    roundId,
    kind: 'lmstudio-response' as const,
    requestUrl: `${session.modelProfileSnapshot.connectionBaseUrl.replace(/\/$/, '')}/chat/completions`,
    requestMethod: 'POST',
    requestHeadersJson: null,
    requestBody: null,
    responseStatus: 200,
    responseHeadersJson: null,
    responseBody: streamedCompletion.rawResponseBody,
    createdAt: completedAt,
  }

  session.status = 'active'
  session.updatedAt = completedAt
  maybeApplyAutomaticSessionTitle(session, turn.sequenceNumber, input.userContent)
  const prefixMessages = requestMessages.slice(0, Math.max(0, requestMessages.length - 1))
  const prefixTokens = prefixMessages.length > 0
    ? await probeRequestPromptTokens(lmStudioGateway, session, prefixMessages, undefined, {
        database,
        sessionId: session.id,
        turnId,
        roundId,
      })
    : 0
  userPart.tokens = deriveExactDeltaTokenMetadata(
    turn.usage.promptTokens,
    prefixTokens,
    'Derived as exact round prompt delta for the current model-only user message',
    'Exact model-only user message tokens could not be derived',
  )
  userPart.provenanceJson = {
    derivedFrom: 'lmstudio.prompt_tokens.user-delta',
  }
  userPart.updatedAt = completedAt

  const finalizeTx = database.connection.transaction(() => {
    updateTurnRecord(database.connection, turn)
    updateRoundRecord(database.connection, round)
    updatePartRecord(database.connection, userPart)
    for (const part of assistantParts) {
      insertPartRecord(database.connection, part)
    }
    insertRawExchangeRecord(database.connection, rawRequestExchange)
    insertRawExchangeRecord(database.connection, rawResponseExchange)
    updateSessionRecord(database.connection, session)
  })
  finalizeTx()

  // Apply context compaction (e.g. strip reasoning) now that the turn is fully persisted.
  const compactedTurn = applyContextCompaction(database.connection, turn, session.compactionStrategy)
  Object.assign(turn, compactedTurn)

  const persistedParts = listPartRecordsBySession(database.connection, session.id)
  assistantParts.forEach(part => emitEvent?.({
    type: 'part-committed',
    part,
  }))
  emitEvent?.({
    type: 'round-committed',
    round: { ...round },
  })
  const trace = buildSessionTraceBundle({
    session,
    turns: listTurnRecordsBySession(database.connection, session.id),
    rounds: listRoundRecordsBySession(database.connection, session.id),
    parts: persistedParts,
    rawExchanges: listRawExchangeRecordsBySession(database.connection, session.id),
    transcript: deriveTranscriptEntries(persistedParts),
    context: deriveContextEntries(persistedParts),
  })
  emitEvent?.({
    type: 'turn-committed',
    turn: { ...turn },
    trace,
  })

  return {
    session,
    turn,
    round,
    rounds: [round],
    parts: persistedParts.filter(part => part.turnId === turnId),
    transcript: trace.transcript,
    context: trace.context,
  }
}
