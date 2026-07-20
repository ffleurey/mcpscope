import type { BackendDatabase } from '../persistence/db.js'
import { runInTransaction } from '../persistence/connection.js'
import {
  createSessionRecord,
  getNextPreludePartSequence,
  getNextRoundPartSequence,
  getNextPartOrdinal,
  listStepRecordsBySession,
  getNextTurnNumber,
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
import { DEFAULT_MAX_TOOL_ROUNDS } from '../domain/model.js'
import {
  deriveContextEntries,
  deriveTranscriptEntries,
  buildModelMessages,
} from '../domain/selectors.js'
import type {
  AssistantSegment,
  OaiChatCompletionResponse,
  PromptProbeResult,
  StreamCallbacks,
  OaiStreamedChatCompletionResult,
} from '../services/openai/client.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import { deriveExactDeltaTokenMetadata } from '../domain/tokenAccounting.js'
import { createSystemPromptPart, ensureSessionPreludeTokenMetadata } from './sessionPrelude.js'
import { probeRequestPromptTokens } from './promptTokenProbing.js'
import { executeChatCompletion, isDegenerateEmptyCompletion } from './streamedCompletion.js'
import type { TurnStreamEventSink } from './streamEvents.js'
import { applyContextCompaction } from '../domain/compaction.js'
import { DEFAULT_SESSION_TITLE, maybeApplyAutomaticSessionTitle } from './sessionTitles.js'
import { buildReasoningParams, normalizeStreamUsage } from '../services/provider/index.js'
import {
  buildDiagnosticNotePart,
  buildStreamFailureRecovery,
  commitSegmentsToParts,
  describeStreamFailure,
  deriveAssistantContentTokenMetadata,
  extractContentSegmentTexts,
  recoverAnswerFromReasoning,
} from './turnAssembly.js'

export interface ChatCompletionGateway {
  createChatCompletion(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<OaiChatCompletionResponse>
  streamChatCompletion?(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
    callbacks?: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<OaiStreamedChatCompletionResult>
  probePromptTokens?(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<number | null>
  probePromptTokensDetailed?(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<PromptProbeResult>
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
  mcpProfileSnapshots?: McpProfileSnapshot[] | undefined
  compactionStrategy?: 'none' | 'strip-reasoning' | undefined
  /** Tool-round budget for this session; defaults to DEFAULT_MAX_TOOL_ROUNDS. */
  maxToolRounds?: number | undefined
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
  ownerStepId?: string | null | undefined
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

export function sessionContextBody(session: SessionRecord): Record<string, unknown> {
  const contextSize = session.modelProfileSnapshot.contextSize
  if (!contextSize) return {}
  return { num_ctx: contextSize }
}

/**
 * Request-body fragment for sampling temperature. When the snapshot has no
 * temperature (null/undefined) the key is omitted entirely so the provider uses
 * its own default. Note: 0 is a valid temperature, so this gates on `!= null`
 * rather than a falsy check (unlike `sessionContextBody`).
 */
export function sessionTemperatureBody(session: SessionRecord): Record<string, unknown> {
  const temperature = session.modelProfileSnapshot.temperature
  if (temperature == null) return {}
  return { temperature }
}

function createUuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

export function createSession(database: BackendDatabase, input: CreateSessionInput): SessionRecord {
  const timestamp = now()
  const explicitSessionId = input.sessionId?.trim().toUpperCase()
  if (explicitSessionId && !isValidSessionId(explicitSessionId)) {
    throw new SessionIdInputError(
      'Session ID must be 4 uppercase characters from A-Z and 2-9, excluding O, I, 0, 1',
    )
  }

  const sessionId =
    explicitSessionId ??
    generateUniqueSessionId(
      (candidate) => getSessionRecord(database.connection, candidate) !== null,
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
    mcpProfileSnapshots: input.mcpProfileSnapshots ?? [],
    loadedContextLength: null,
    systemPromptTokens: null,
    toolDefinitionsTokens: null,
    isContextExhausted: false,
    compactionStrategy: input.compactionStrategy ?? 'strip-reasoning',
    maxToolRounds: input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS,
  }

  const tx = () =>
    runInTransaction(database.connection, () => {
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

interface ModelTurnFailureInfo {
  message: string
  receivedBytes: number | null
  segments: AssistantSegment[]
  completion: OaiChatCompletionResponse | null
  errorType: 'internal' | 'aborted' | 'provider_unreachable'
}

/**
 * Closes out a model-only turn that couldn't reach a clean 'stop' — a
 * mid-stream read failure, or a finish_reason the pipeline doesn't otherwise
 * understand — without discarding whatever the model already streamed.
 * Mirrors the tool-loop-limit graceful-close block in toolTurns.ts: persist
 * everything recoverable, mark the round/turn 'error', and return a normal
 * RuntimeTurnResult instead of throwing, so the failure is visible in the
 * transcript rather than swallowed.
 */
function finalizeModelTurnStreamFailure(
  database: BackendDatabase,
  session: SessionRecord,
  turn: TurnRecord,
  round: RoundRecord,
  turnId: string,
  turnNumber: number,
  ownerStepId: string | null,
  requestBody: Record<string, unknown>,
  info: ModelTurnFailureInfo,
  emitEvent: TurnStreamEventSink | undefined,
): RuntimeTurnResult {
  const completedAt = now()

  const recovery = buildStreamFailureRecovery({
    session,
    turnId,
    turnNumber,
    roundNumber: 1,
    roundId: round.id,
    ownerStepId,
    segments: info.segments,
    message: info.message,
    receivedBytes: info.receivedBytes,
    initialOrdinal: getNextPartOrdinal(database.connection, session.id),
    initialPartNumber: getNextRoundPartSequence(database.connection, round.id),
    createdAt: completedAt,
  })

  round.status = 'error'
  round.finishReason = info.errorType === 'aborted' ? 'cancelled' : 'error'
  round.completedAt = completedAt
  round.requestPayloadJson = requestBody
  round.responseTraceJson = {
    completion: info.completion,
    assistantSegments: info.segments,
    error: info.message,
  }

  turn.status = info.errorType === 'aborted' ? 'aborted' : 'error'
  turn.completedAt = completedAt
  turn.outcome = `step-error: ${info.message}`

  const errorTx = () =>
    runInTransaction(database.connection, () => {
      updateRoundRecord(database.connection, round)
      for (const part of recovery.parts) {
        insertPartRecord(database.connection, part)
      }
      updateTurnRecord(database.connection, turn)
      updateSessionRecord(database.connection, session)
    })
  errorTx()

  recovery.parts.forEach((part) =>
    emitEvent?.({
      type: 'part-committed',
      part: { ...part },
    }),
  )
  emitEvent?.({
    type: 'round-committed',
    round: { ...round },
  })

  const persistedPartsOnError = listPartRecordsBySession(database.connection, session.id)
  const traceOnError = buildSessionTraceBundle({
    session,
    steps: listStepRecordsBySession(database.connection, session.id),
    turns: listTurnRecordsBySession(database.connection, session.id),
    rounds: listRoundRecordsBySession(database.connection, session.id),
    parts: persistedPartsOnError,
    rawExchanges: listRawExchangeRecordsBySession(database.connection, session.id),
    transcript: deriveTranscriptEntries(persistedPartsOnError),
    context: deriveContextEntries(persistedPartsOnError),
  })
  // turn-failed, not turn-committed: relaySchedulerJobStream (backend/src/app.ts)
  // closes the SSE stream on the first event matching either type, so only one
  // of the two would ever reach a live subscriber. turn-failed is the existing
  // contract streaming clients key off of for the session-level error banner;
  // the part-committed/round-committed events already emitted above carry the
  // recovered content live, and the full trace (including this turn's 'error'
  // status) is available on the next fetch regardless.
  emitEvent?.({
    type: 'turn-failed',
    turnId,
    errorType: info.errorType,
    message: info.message,
  })

  return {
    session,
    turn,
    round,
    rounds: [round],
    parts: persistedPartsOnError.filter((part) => part.turnId === turnId),
    transcript: traceOnError.transcript,
    context: traceOnError.context,
  }
}

export async function createModelOnlyTurn(
  database: BackendDatabase,
  chatCompletionGateway: ChatCompletionGateway,
  input: CreateTurnInput,
  emitEvent?: TurnStreamEventSink,
): Promise<RuntimeTurnResult> {
  const session = getSessionRecord(database.connection, input.sessionId)
  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  const existingParts = await ensureSessionPreludeTokenMetadata(
    database,
    chatCompletionGateway,
    session,
    listPartRecordsBySession(database.connection, session.id),
  )
  const requestMessages = buildModelMessages(session, existingParts, input.userContent)
  const startedAt = input.reservedTurn?.createdAt ?? now()
  const turnNumber =
    input.reservedTurn?.turnNumber ??
    getNextTurnNumber(database.connection, session.id, input.ownerStepId ?? null)
  const turnId =
    input.reservedTurn?.id ?? formatTurnId(session.id, turnNumber, input.ownerStepId ?? null)
  const roundId = formatRoundId(session.id, turnNumber, 1, input.ownerStepId ?? null)
  const turn: TurnRecord = input.reservedTurn
    ? { ...input.reservedTurn }
    : {
        id: turnId,
        sessionId: session.id,
        ownerStepId: input.ownerStepId ?? null,
        turnNumber,
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
    stream: true,
    stream_options: {
      include_usage: true,
    },
    messages: requestMessages,
    ...sessionTemperatureBody(session),
    ...buildReasoningParams(
      session.modelProfileSnapshot.reasoning,
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.providerType,
    ),
    ...sessionContextBody(session),
  }

  const initialOrdinal = getNextPartOrdinal(database.connection, session.id)
  const initialPartNumber = getNextRoundPartSequence(database.connection, roundId)
  const userPart: PartRecord = {
    id: formatPartId(
      session.id,
      turnNumber,
      1,
      initialPartNumber,
      'user-message',
      input.ownerStepId ?? null,
    ),
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

  const persistInitialState = () =>
    runInTransaction(database.connection, () => {
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

  let streamedCompletion: OaiStreamedChatCompletionResult
  try {
    streamedCompletion = await executeChatCompletion(
      chatCompletionGateway,
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
  } catch (err) {
    return finalizeModelTurnStreamFailure(
      database,
      session,
      turn,
      round,
      turnId,
      turnNumber,
      input.ownerStepId ?? null,
      requestBody,
      describeStreamFailure(err),
      emitEvent,
    )
  }
  const completion = streamedCompletion.completion

  const completedAt = now()
  const finishReason = completion.choices[0]?.finish_reason
  // A finish_reason other than "stop" or "length" means the pipeline doesn't
  // recognize how the model ended the turn (e.g. a content filter, or a
  // provider-specific reason). Treat it like a stream failure — the model did
  // stream something, so recover it instead of discarding it.
  if (finishReason !== 'stop' && finishReason !== 'length') {
    return finalizeModelTurnStreamFailure(
      database,
      session,
      turn,
      round,
      turnId,
      turnNumber,
      input.ownerStepId ?? null,
      requestBody,
      {
        message: `Unsupported finish reason for model-only pipeline: ${finishReason ?? 'unknown'}`,
        receivedBytes: null,
        segments: streamedCompletion.segments,
        completion,
        errorType: 'internal',
      },
      emitEvent,
    )
  }
  // A response that arrived intact but empty — no content and no reasoning text
  // (finish_reason "stop", not "length") — is a provider/connection failure, not
  // a real answer. Treat it as a manually-retryable error rather than a
  // completed, answerless turn. (Common with OpenRouter-fronted models that burn
  // their whole budget on hidden reasoning; see isDegenerateEmptyCompletion.)
  if (isDegenerateEmptyCompletion(streamedCompletion)) {
    return finalizeModelTurnStreamFailure(
      database,
      session,
      turn,
      round,
      turnId,
      turnNumber,
      input.ownerStepId ?? null,
      requestBody,
      {
        message:
          'Model returned an empty response (no content or reasoning). This is usually a transient provider or connection error — retry the session.',
        receivedBytes: null,
        segments: [],
        completion,
        errorType: 'provider_unreachable',
      },
      emitEvent,
    )
  }
  const truncated = finishReason === 'length'

  const provider = session.modelProfileSnapshot.providerType ?? 'lmstudio'
  const usage = normalizeStreamUsage(streamedCompletion.rawResponseBody, provider)

  turn.status = 'complete'
  turn.completedAt = completedAt
  turn.outcome = truncated ? 'model-response-truncated' : 'model-response'
  turn.usage = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
  }

  round.status = 'complete'
  round.finishReason = truncated ? 'length' : 'stop'
  round.completedAt = completedAt
  round.usage = { ...turn.usage }
  round.requestPayloadJson = requestBody
  round.responseTraceJson = {
    completion,
    assistantSegments: streamedCompletion.segments,
  }

  // Recover an answer emitted in the reasoning channel with empty content
  // (interleaved-thinking models) — but not on a truncated round, where
  // reasoning is partial thinking rather than the final answer.
  const { segments: answerSegments, recovered: answerFromReasoning } = truncated
    ? { segments: streamedCompletion.segments, recovered: false }
    : recoverAnswerFromReasoning(streamedCompletion.segments)
  const contentSegments = extractContentSegmentTexts(answerSegments)

  const {
    parts: streamedParts,
    nextOrdinal,
    nextPartNumber,
  } = commitSegmentsToParts({
    session,
    turnId,
    turnNumber,
    roundNumber: 1,
    roundId,
    ownerStepId: input.ownerStepId ?? null,
    segments: answerSegments,
    reasoningTokens: usage.reasoningTokens,
    contentTokenMetadata: deriveAssistantContentTokenMetadata(
      contentSegments,
      usage.assistantContentTokens,
    ),
    contentContextNote: 'Assistant answer remains part of later model-visible history',
    initialOrdinal: initialOrdinal + 1,
    initialPartNumber: initialPartNumber + 1,
    createdAt: completedAt,
  })

  // Truncation isn't an error — the response is complete-but-capped — but it's
  // still an anomaly worth surfacing in the transcript rather than leaving
  // buried in round.finishReason. A reasoning-channel recovery gets its own note
  // so the coercion is visible rather than silent.
  const assistantParts = truncated
    ? [
        ...streamedParts,
        buildDiagnosticNotePart({
          session,
          turnId,
          turnNumber,
          roundNumber: 1,
          roundId,
          ownerStepId: input.ownerStepId ?? null,
          partNumber: nextPartNumber,
          ordinal: nextOrdinal,
          text: 'Response was truncated: the model reached the max output token limit (finish_reason: length) before finishing. Retry or raise the output token limit for a complete answer.',
          summary: 'Response truncated (max output tokens reached)',
          createdAt: completedAt,
        }),
      ]
    : answerFromReasoning
      ? [
          ...streamedParts,
          buildDiagnosticNotePart({
            session,
            turnId,
            turnNumber,
            roundNumber: 1,
            roundId,
            ownerStepId: input.ownerStepId ?? null,
            partNumber: nextPartNumber,
            ordinal: nextOrdinal,
            text: 'Final answer recovered from the reasoning channel: the model ended the turn with empty content but non-empty reasoning (common for interleaved-thinking models). The reasoning text is surfaced as the assistant answer so it is retained and scored.',
            summary: 'Answer recovered from reasoning channel',
            createdAt: completedAt,
          }),
        ]
      : streamedParts

  const rawRequestExchange = {
    id: createUuid(),
    sessionId: session.id,
    turnId,
    roundId,
    kind: 'llm-request' as const,
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
    kind: 'llm-response' as const,
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
  maybeApplyAutomaticSessionTitle(session, turn.turnNumber, input.userContent, emitEvent)
  // SHORTCUT: this attribution probe runs BEFORE the turn's finalize
  // transaction, so a transient non-400 probe failure (which
  // probeRequestPromptTokens deliberately propagates) throws away an
  // already-successful model response and errors the turn. Paying this back =
  // finalize the turn first, then attribute tokens best-effort (null counts on
  // probe failure), as the tool pipeline's suffix attribution does.
  const prefixMessages = requestMessages.slice(0, Math.max(0, requestMessages.length - 1))
  const prefixTokens =
    prefixMessages.length > 0
      ? await probeRequestPromptTokens(chatCompletionGateway, session, prefixMessages, undefined, {
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
    derivedFrom: 'prompt_tokens.user-delta',
  }
  userPart.updatedAt = completedAt

  const finalizeTx = () =>
    runInTransaction(database.connection, () => {
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
  const compaction = applyContextCompaction(database.connection, turn, session.compactionStrategy)
  Object.assign(turn, compaction.turn)

  const persistedParts = listPartRecordsBySession(database.connection, session.id)
  assistantParts.forEach((part) =>
    emitEvent?.({
      type: 'part-committed',
      part,
    }),
  )
  emitEvent?.({
    type: 'round-committed',
    round: { ...round },
  })
  const trace = buildSessionTraceBundle({
    session,
    steps: listStepRecordsBySession(database.connection, session.id),
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
    parts: persistedParts.filter((part) => part.turnId === turnId),
    transcript: trace.transcript,
    context: trace.context,
  }
}
