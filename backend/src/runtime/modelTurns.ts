import type { BackendDatabase } from "../persistence/db.js";
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
} from "../persistence/repository.js";
import {
  formatPartId,
  formatRoundId,
  formatTurnId,
  generateUniqueSessionId,
  isValidSessionId,
} from "../domain/hierarchicalIds.js";
import type {
  McpProfileSnapshot,
  ModelProfileSnapshot,
  ParentKind,
  PartRecord,
  RoundRecord,
  SessionRecord,
  SessionType,
  TurnRecord,
} from "../domain/model.js";
import {
  deriveContextEntries,
  deriveTranscriptEntries,
  buildModelMessages,
} from "../domain/selectors.js";
import type {
  OaiChatCompletionResponse,
  PromptProbeResult,
  StreamCallbacks,
  OaiStreamedChatCompletionResult,
} from "../services/openai/client.js";
import { buildSessionTraceBundle } from "../domain/trace.js";
import { deriveExactDeltaTokenMetadata } from "../domain/tokenAccounting.js";
import {
  createSystemPromptPart,
  ensureSessionPreludeTokenMetadata,
} from "./sessionPrelude.js";
import { probeRequestPromptTokens } from "./promptTokenProbing.js";
import { executeChatCompletion } from "./streamedCompletion.js";
import type { TurnStreamEventSink } from "./streamEvents.js";
import { applyContextCompaction } from "../domain/compaction.js";
import {
  DEFAULT_SESSION_TITLE,
  maybeApplyAutomaticSessionTitle,
} from "./sessionTitles.js";
import {
  buildReasoningParams,
  normalizeStreamUsage,
} from "../services/provider/index.js";
import {
  commitSegmentsToParts,
  deriveAssistantContentTokenMetadata,
  extractContentSegmentTexts,
} from "./turnAssembly.js";

export interface ChatCompletionGateway {
  createChatCompletion(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<OaiChatCompletionResponse>;
  streamChatCompletion?(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
    callbacks?: StreamCallbacks,
  ): Promise<OaiStreamedChatCompletionResult>;
  probePromptTokens?(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<number | null>;
  probePromptTokensDetailed?(
    baseUrl: string,
    apiKey: string | undefined,
    body: Record<string, unknown>,
  ): Promise<PromptProbeResult>;
  getLoadedContextLength?(
    baseUrl: string,
    apiKey: string | undefined,
    modelKey: string,
  ): Promise<number | null>;
}

export interface CreateSessionInput {
  sessionId?: string | undefined;
  title?: string | undefined;
  modelProfileSnapshot: ModelProfileSnapshot;
  mcpProfileSnapshots?: McpProfileSnapshot[] | undefined;
  compactionStrategy?: "none" | "strip-reasoning" | undefined;
  /** Session type. Defaults to 'primary' when omitted. */
  sessionType?: SessionType | undefined;
  /** Parent object kind. Must be provided together with parentId. */
  parentKind?: ParentKind | null | undefined;
  /** Parent object id. Must be provided together with parentKind. */
  parentId?: string | null | undefined;
}

export interface CreateTurnInput {
  sessionId: string;
  userContent: string;
  ownerStepId?: string | null | undefined;
  reservedTurn?: TurnRecord | undefined;
}

export interface RuntimeTurnResult {
  session: SessionRecord;
  turn: TurnRecord;
  round: RoundRecord;
  rounds: RoundRecord[];
  parts: PartRecord[];
  transcript: ReturnType<typeof deriveTranscriptEntries>;
  context: ReturnType<typeof deriveContextEntries>;
}

export class SessionIdInputError extends Error {}
export class SessionIdConflictError extends Error {}
export class SessionIdGenerationError extends Error {}

export function sessionContextBody(
  session: SessionRecord,
): Record<string, unknown> {
  const contextSize = session.modelProfileSnapshot.contextSize;
  if (!contextSize) return {};
  return { num_ctx: contextSize };
}

function createUuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

export function createSession(
  database: BackendDatabase,
  input: CreateSessionInput,
): SessionRecord {
  const timestamp = now();
  const explicitSessionId = input.sessionId?.trim().toUpperCase();
  if (explicitSessionId && !isValidSessionId(explicitSessionId)) {
    throw new SessionIdInputError(
      "Session ID must be 4 uppercase characters from A-Z and 2-9, excluding O, I, 0, 1",
    );
  }

  const sessionId =
    explicitSessionId ??
    generateUniqueSessionId(
      (candidate) => getSessionRecord(database.connection, candidate) !== null,
      3,
    );

  if (sessionId == null) {
    throw new SessionIdGenerationError(
      "Could not generate a unique session ID after 3 attempts",
    );
  }

  if (getSessionRecord(database.connection, sessionId) !== null) {
    throw new SessionIdConflictError(`Session ID already exists: ${sessionId}`);
  }

  const session: SessionRecord = {
    id: sessionId,
    title: input.title?.trim() || DEFAULT_SESSION_TITLE,
    status: "ready",
    initStatus: "pending",
    sessionType: input.sessionType ?? "primary",
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
    compactionStrategy: input.compactionStrategy ?? "strip-reasoning",
  };

  const tx = database.connection.transaction(() => {
    createSessionRecord(database.connection, session);
    const systemPromptPart = createSystemPromptPart(
      session,
      getNextPartOrdinal(database.connection, session.id),
      getNextPreludePartSequence(database.connection, session.id),
      timestamp,
    );
    if (systemPromptPart) {
      insertPartRecord(database.connection, systemPromptPart);
    }
  });
  tx();

  return session;
}

export async function createModelOnlyTurn(
  database: BackendDatabase,
  chatCompletionGateway: ChatCompletionGateway,
  input: CreateTurnInput,
  emitEvent?: TurnStreamEventSink,
): Promise<RuntimeTurnResult> {
  const session = getSessionRecord(database.connection, input.sessionId);
  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }

  const existingParts = await ensureSessionPreludeTokenMetadata(
    database,
    chatCompletionGateway,
    session,
    listPartRecordsBySession(database.connection, session.id),
  );
  const requestMessages = buildModelMessages(
    session,
    existingParts,
    input.userContent,
  );
  const startedAt = input.reservedTurn?.createdAt ?? now();
  const turnNumber =
    input.reservedTurn?.turnNumber ??
    getNextTurnNumber(
      database.connection,
      session.id,
      input.ownerStepId ?? null,
    );
  const turnId =
    input.reservedTurn?.id ??
    formatTurnId(session.id, turnNumber, input.ownerStepId ?? null);
  const roundId = formatRoundId(
    session.id,
    turnNumber,
    1,
    input.ownerStepId ?? null,
  );
  const turn: TurnRecord = input.reservedTurn
    ? { ...input.reservedTurn }
    : {
        id: turnId,
        sessionId: session.id,
        ownerStepId: input.ownerStepId ?? null,
        turnNumber,
        status: "streaming",
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
      };
  const round: RoundRecord = {
    id: roundId,
    turnId,
    roundIndex: 0,
    status: "streaming",
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
  };

  const requestBody = {
    model: session.modelProfileSnapshot.modelKey,
    temperature: session.modelProfileSnapshot.temperature,
    stream: true,
    stream_options: {
      include_usage: true,
    },
    messages: requestMessages,
    ...buildReasoningParams(
      session.modelProfileSnapshot.reasoning,
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.providerType,
    ),
    ...sessionContextBody(session),
  };

  const initialOrdinal = getNextPartOrdinal(database.connection, session.id);
  const initialPartNumber = getNextRoundPartSequence(
    database.connection,
    roundId,
  );
  const userPart: PartRecord = {
    id: formatPartId(
      session.id,
      turnNumber,
      1,
      initialPartNumber,
      "user-message",
      input.ownerStepId ?? null,
    ),
    sessionId: session.id,
    turnId,
    roundId,
    parentPartId: null,
    ordinal: initialOrdinal,
    partType: "user-message",
    roleLabel: "user",
    payload: {
      text: input.userContent,
      json: null,
      mimeType: null,
      summary: null,
    },
    display: {
      state: "transcript",
      collapsedByDefault: false,
    },
    context: {
      state: "included",
      note: null,
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: null,
      source: "unknown",
      confidence: "unknown",
      note: "Prompt split not derived yet",
    },
    provenanceJson: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  };

  const persistInitialState = database.connection.transaction(() => {
    if (!input.reservedTurn) {
      insertTurnRecord(database.connection, turn);
    }
    insertRoundRecord(database.connection, round);
    insertPartRecord(database.connection, userPart);
  });
  persistInitialState();
  emitEvent?.({
    type: "turn-started",
    turn: { ...turn },
  });
  emitEvent?.({
    type: "round-started",
    round: { ...round },
  });

  const streamedCompletion = await executeChatCompletion(
    chatCompletionGateway,
    session.modelProfileSnapshot.connectionBaseUrl,
    session.modelProfileSnapshot.apiKey ?? undefined,
    requestBody,
    {
      onDelta(delta) {
        emitEvent?.({
          type: "part-delta",
          turnId,
          roundId,
          delta,
        });
      },
    },
  );
  const completion = streamedCompletion.completion;

  const completedAt = now();
  const finishReason = completion.choices[0]?.finish_reason;
  if (finishReason !== "stop") {
    throw new Error(
      `Unsupported finish reason for model-only pipeline: ${finishReason ?? "unknown"}`,
    );
  }

  const provider = session.modelProfileSnapshot.providerType ?? "lmstudio";
  const usage = normalizeStreamUsage(
    streamedCompletion.rawResponseBody,
    provider,
  );

  turn.status = "complete";
  turn.completedAt = completedAt;
  turn.outcome = "model-response";
  turn.usage = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
  };

  round.status = "complete";
  round.finishReason = "stop";
  round.completedAt = completedAt;
  round.usage = { ...turn.usage };
  round.requestPayloadJson = requestBody;
  round.responseTraceJson = {
    completion,
    assistantSegments: streamedCompletion.segments,
  };

  const contentSegments = extractContentSegmentTexts(
    streamedCompletion.segments,
  );

  const { parts: assistantParts } = commitSegmentsToParts({
    session,
    turnId,
    turnNumber,
    roundNumber: 1,
    roundId,
    ownerStepId: input.ownerStepId ?? null,
    segments: streamedCompletion.segments,
    reasoningTokens: usage.reasoningTokens,
    contentTokenMetadata: deriveAssistantContentTokenMetadata(
      contentSegments,
      usage.assistantContentTokens,
    ),
    contentContextNote:
      "Assistant answer remains part of later model-visible history",
    initialOrdinal: initialOrdinal + 1,
    initialPartNumber: initialPartNumber + 1,
    createdAt: completedAt,
  });

  const rawRequestExchange = {
    id: createUuid(),
    sessionId: session.id,
    turnId,
    roundId,
    kind: "llm-request" as const,
    requestUrl: `${session.modelProfileSnapshot.connectionBaseUrl.replace(/\/$/, "")}/chat/completions`,
    requestMethod: "POST",
    requestHeadersJson: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    requestBody: JSON.stringify(requestBody),
    responseStatus: 200,
    responseHeadersJson: null,
    responseBody: null,
    createdAt: startedAt,
  };

  const rawResponseExchange = {
    id: createUuid(),
    sessionId: session.id,
    turnId,
    roundId,
    kind: "llm-response" as const,
    requestUrl: `${session.modelProfileSnapshot.connectionBaseUrl.replace(/\/$/, "")}/chat/completions`,
    requestMethod: "POST",
    requestHeadersJson: null,
    requestBody: null,
    responseStatus: 200,
    responseHeadersJson: null,
    responseBody: streamedCompletion.rawResponseBody,
    createdAt: completedAt,
  };

  session.status = "active";
  session.updatedAt = completedAt;
  maybeApplyAutomaticSessionTitle(session, turn.turnNumber, input.userContent);
  const prefixMessages = requestMessages.slice(
    0,
    Math.max(0, requestMessages.length - 1),
  );
  const prefixTokens =
    prefixMessages.length > 0
      ? await probeRequestPromptTokens(
          chatCompletionGateway,
          session,
          prefixMessages,
          undefined,
          {
            database,
            sessionId: session.id,
            turnId,
            roundId,
          },
        )
      : 0;
  userPart.tokens = deriveExactDeltaTokenMetadata(
    turn.usage.promptTokens,
    prefixTokens,
    "Derived as exact round prompt delta for the current model-only user message",
    "Exact model-only user message tokens could not be derived",
  );
  userPart.provenanceJson = {
    derivedFrom: "prompt_tokens.user-delta",
  };
  userPart.updatedAt = completedAt;

  const finalizeTx = database.connection.transaction(() => {
    updateTurnRecord(database.connection, turn);
    updateRoundRecord(database.connection, round);
    updatePartRecord(database.connection, userPart);
    for (const part of assistantParts) {
      insertPartRecord(database.connection, part);
    }
    insertRawExchangeRecord(database.connection, rawRequestExchange);
    insertRawExchangeRecord(database.connection, rawResponseExchange);
    updateSessionRecord(database.connection, session);
  });
  finalizeTx();

  // Apply context compaction (e.g. strip reasoning) now that the turn is fully persisted.
  const compaction = applyContextCompaction(
    database.connection,
    turn,
    session.compactionStrategy,
  );
  Object.assign(turn, compaction.turn);

  const persistedParts = listPartRecordsBySession(
    database.connection,
    session.id,
  );
  assistantParts.forEach((part) =>
    emitEvent?.({
      type: "part-committed",
      part,
    }),
  );
  compaction.parts.forEach((part) =>
    emitEvent?.({
      type: "part-committed",
      part,
    }),
  );
  emitEvent?.({
    type: "round-committed",
    round: { ...round },
  });
  const trace = buildSessionTraceBundle({
    session,
    steps: listStepRecordsBySession(database.connection, session.id),
    turns: listTurnRecordsBySession(database.connection, session.id),
    rounds: listRoundRecordsBySession(database.connection, session.id),
    parts: persistedParts,
    rawExchanges: listRawExchangeRecordsBySession(
      database.connection,
      session.id,
    ),
    transcript: deriveTranscriptEntries(persistedParts),
    context: deriveContextEntries(persistedParts),
  });
  emitEvent?.({
    type: "turn-committed",
    turn: { ...turn },
    trace,
  });

  return {
    session,
    turn,
    round,
    rounds: [round],
    parts: persistedParts.filter(
      (part) => part.turnId === turnId || part.turnId === compaction.step.id,
    ),
    transcript: trace.transcript,
    context: trace.context,
  };
}
