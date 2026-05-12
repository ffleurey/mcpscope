import type { BackendDatabase } from '../persistence/db.js'
import type {
  PartRecord,
  RawExchangeRecord,
  RoundRecord,
  SessionRecord,
  TurnRecord,
} from '../domain/model.js'
import { buildApiMessages, buildLmToolDefinitions, deriveContextEntries, deriveTranscriptEntries } from '../domain/selectors.js'
import {
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
import type { LmStudioGateway, RuntimeTurnResult } from './modelTurns.js'
import type { ApiMessage } from '../domain/selectors.js'
import type { McpRawExchange, McpToolCallResult, McpToolsListResult } from '../services/mcp/httpClient.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import {
  allocateProportionalTokenCounts,
  deriveExactDeltaTokenMetadata,
  normalizeLmStudioUsageFromResponse,
} from '../domain/tokenAccounting.js'
import {
  deriveExactToolPreludeTokens,
  ensureSessionPreludeTokenMetadata,
} from './sessionPrelude.js'
import { probeRequestPromptTokens } from './promptTokenProbing.js'
import { applyContextCompaction } from '../domain/compaction.js'
import { executeChatCompletion } from './streamedCompletion.js'
import type { TurnStreamEventSink } from './streamEvents.js'

export interface McpGateway {
  initializeSession(serverUrl: string): Promise<{
    sessionId: string | null
    instructions?: string | undefined
    rawExchange: McpRawExchange
  }>
  listTools(serverUrl: string, sessionId: string | null): Promise<McpToolsListResult>
  callTool(serverUrl: string, sessionId: string | null, name: string, args: Record<string, unknown>): Promise<McpToolCallResult>
}

interface ToolCallRecord {
  id: string
  name: string
  argumentsJson: string
}

type PendingPromptSuffixAttribution =
  | {
      kind: 'user-message'
      baseMessageCount: number
      userPart: PartRecord
    }
  | {
      kind: 'tool-cycle'
      baseMessageCount: number
      assistantContentParts: PartRecord[]
      toolCallParts: PartRecord[]
      toolResultParts: PartRecord[]
    }

function createUuid(): string {
  return crypto.randomUUID()
}

function now(): number {
  return Date.now()
}

function makeRawExchangeRecord(
  sessionId: string,
  turnId: string | null,
  roundId: string | null,
  kind: RawExchangeRecord['kind'],
  exchange: McpRawExchange,
  createdAt: number,
): RawExchangeRecord {
  return {
    id: createUuid(),
    sessionId,
    turnId,
    roundId,
    kind,
    requestUrl: exchange.requestUrl,
    requestMethod: exchange.requestMethod,
    requestHeadersJson: exchange.requestHeaders ?? null,
    requestBody: exchange.requestBodyText,
    responseStatus: exchange.responseStatus,
    responseHeadersJson: exchange.responseHeaders ?? null,
    responseBody: exchange.responseBodyText ?? JSON.stringify(exchange.responseBody),
    createdAt,
  }
}

function parseToolCalls(round: RoundRecord, response: Awaited<ReturnType<LmStudioGateway['createChatCompletion']>>): ToolCallRecord[] {
  const toolCalls = response.choices[0]?.message?.tool_calls ?? []
  return toolCalls.map((toolCall, index) => ({
    id: toolCall.id ?? `${round.id}-tool-${index}`,
    name: toolCall.function?.name ?? 'unknown',
    argumentsJson: toolCall.function?.arguments ?? '{}',
  }))
}

function createLmStudioRawExchange(
  session: SessionRecord,
  turnId: string,
  roundId: string,
  requestBody: Record<string, unknown>,
  responseBody: string,
  startedAt: number,
  completedAt: number,
): RawExchangeRecord[] {
  const endpoint = `${session.modelProfileSnapshot.connectionBaseUrl.replace(/\/$/, '')}/chat/completions`
  return [
    {
      id: createUuid(),
      sessionId: session.id,
      turnId,
      roundId,
      kind: 'lmstudio-request',
      requestUrl: endpoint,
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
    },
    {
      id: createUuid(),
      sessionId: session.id,
      turnId,
      roundId,
      kind: 'lmstudio-response',
      requestUrl: endpoint,
      requestMethod: 'POST',
      requestHeadersJson: null,
      requestBody: null,
      responseStatus: 200,
      responseHeadersJson: null,
      responseBody,
      createdAt: completedAt,
    },
  ]
}

function serializeToolCallWeight(part: PartRecord): number {
  const toolJson = part.payload.json as { id?: string; name?: string; arguments?: string } | null
  return JSON.stringify({
    id: toolJson?.id ?? part.id,
    name: toolJson?.name ?? 'unknown',
    arguments: toolJson?.arguments ?? '{}',
  }).length
}

function serializeAssistantContentWeight(part: PartRecord): number {
  return (part.payload.text ?? '').length
}

function updatePartTokens(
  part: PartRecord,
  tokens: PartRecord['tokens'],
  provenanceJson: unknown,
  updatedAt: number,
): PartRecord {
  return {
    ...part,
    tokens,
    provenanceJson,
    updatedAt,
  }
}

async function applyPendingPromptSuffixAttribution(
  database: BackendDatabase,
  lmStudioGateway: LmStudioGateway,
  session: SessionRecord,
  requestMessages: ApiMessage[],
  lmTools: ReturnType<typeof buildLmToolDefinitions>,
  promptTokens: number | null,
  sessionParts: PartRecord[],
  pending: PendingPromptSuffixAttribution | null,
): Promise<PendingPromptSuffixAttribution | null> {
  if (!pending || promptTokens == null) {
    return null
  }

  const updatedAt = now()

  if (pending.kind === 'user-message') {
    const prefixMessages = requestMessages.slice(0, pending.baseMessageCount)
    const prefixTokens = prefixMessages.length > 0
      ? await probeRequestPromptTokens(lmStudioGateway, session, prefixMessages, lmTools, {
          database,
          sessionId: session.id,
          turnId: pending.userPart.turnId,
          roundId: pending.userPart.roundId,
        })
      : deriveExactToolPreludeTokens(sessionParts)
    const tokens = deriveExactDeltaTokenMetadata(
      promptTokens,
      prefixTokens,
      'Derived as exact round prompt delta for the current tool-enabled user message',
      'Exact tool-enabled user message tokens could not be derived',
    )
    const updatedPart = updatePartTokens(
      pending.userPart,
      tokens,
      { derivedFrom: 'lmstudio.prompt_tokens.user-delta' },
      updatedAt,
    )

    const tx = database.connection.transaction(() => {
      updatePartRecord(database.connection, updatedPart)
    })
    tx()

    pending.userPart.tokens = updatedPart.tokens
    pending.userPart.provenanceJson = updatedPart.provenanceJson
    pending.userPart.updatedAt = updatedPart.updatedAt
    return null
  }

  const prefixMessages = requestMessages.slice(0, pending.baseMessageCount)
  const traceContext = {
    database,
    sessionId: session.id,
    turnId: pending.toolCallParts[0]?.turnId ?? pending.assistantContentParts[0]?.turnId ?? null,
    roundId: pending.toolCallParts[0]?.roundId ?? pending.assistantContentParts[0]?.roundId ?? null,
  }
  const prefixTokens = await probeRequestPromptTokens(lmStudioGateway, session, prefixMessages, lmTools, traceContext)
  if (prefixTokens == null) {
    return null
  }

  const toolCallMessageIndex = pending.baseMessageCount
  const afterToolCallMessages = requestMessages.slice(0, toolCallMessageIndex + 1)
  const afterToolCallTokens = pending.toolResultParts.length > 0
    ? await probeRequestPromptTokens(lmStudioGateway, session, afterToolCallMessages, lmTools, traceContext)
    : promptTokens

  if (afterToolCallTokens == null) {
    return null
  }

  const toolCallGroupTokens = Math.max(0, afterToolCallTokens - prefixTokens)
  const groupedAssistantParts = [
    ...pending.assistantContentParts,
    ...pending.toolCallParts,
  ]
  const groupedAllocations = pending.assistantContentParts.length === 0 && pending.toolCallParts.length === 1
    ? [toolCallGroupTokens]
    : allocateProportionalTokenCounts(
        toolCallGroupTokens,
        groupedAssistantParts.map(part => (
          part.partType === 'assistant-content'
            ? serializeAssistantContentWeight(part)
            : serializeToolCallWeight(part)
        )),
      )

  let runningTokens = afterToolCallTokens
  const updatedAssistantContentParts = pending.assistantContentParts.map((part, index) => updatePartTokens(
        part,
        {
          count: groupedAllocations[index] ?? 0,
          source: 'estimated',
          confidence: 'estimated',
          note: 'Allocated proportionally from the exact grouped assistant message delta shared with tool calls',
        },
        { derivedFrom: 'lmstudio.prompt_tokens.assistant-tool-message-delta', allocation: 'proportional-by-payload' },
        updatedAt,
      ))
  const toolCallAllocationOffset = pending.assistantContentParts.length
  const updatedToolCallParts = pending.toolCallParts.map((part, index) => {
    const count = groupedAllocations[index + toolCallAllocationOffset] ?? 0
    return updatePartTokens(
      part,
      pending.assistantContentParts.length === 0 && pending.toolCallParts.length === 1
        ? {
            count,
            source: 'delta-derived',
            confidence: 'exact',
            note: 'Derived as exact prompt delta for the assistant tool-call message',
          }
        : {
            count,
            source: 'estimated',
            confidence: 'estimated',
            note: 'Allocated proportionally from the exact grouped assistant tool-call prompt delta',
          },
      pending.assistantContentParts.length === 0 && pending.toolCallParts.length === 1
        ? { derivedFrom: 'lmstudio.prompt_tokens.tool-call-delta' }
        : { derivedFrom: 'lmstudio.prompt_tokens.assistant-tool-message-delta', allocation: 'proportional-by-payload' },
      updatedAt,
    )
  })

  const updatedToolResultParts: PartRecord[] = []
  for (let index = 0; index < pending.toolResultParts.length; index++) {
    const part = pending.toolResultParts[index]
    if (!part) continue

    const isLast = index === pending.toolResultParts.length - 1
    const nextRunningTokens = isLast
      ? promptTokens
      : await probeRequestPromptTokens(
          lmStudioGateway,
          session,
          requestMessages.slice(0, toolCallMessageIndex + 2 + index),
          lmTools,
          {
            database,
            sessionId: session.id,
            turnId: part.turnId,
            roundId: part.roundId,
          },
        )

    const tokens = deriveExactDeltaTokenMetadata(
      nextRunningTokens,
      runningTokens,
      'Derived as exact prompt delta for the tool result message',
      'Exact tool-result prompt tokens could not be derived',
    )

    const updatedPart = updatePartTokens(
      part,
      tokens,
      { derivedFrom: 'lmstudio.prompt_tokens.tool-result-delta' },
      updatedAt,
    )
    updatedToolResultParts.push(updatedPart)
    runningTokens = nextRunningTokens ?? runningTokens
  }

  const tx = database.connection.transaction(() => {
    updatedAssistantContentParts.forEach(part => updatePartRecord(database.connection, part))
    updatedToolCallParts.forEach(part => updatePartRecord(database.connection, part))
    updatedToolResultParts.forEach(part => updatePartRecord(database.connection, part))
  })
  tx()

  pending.assistantContentParts.forEach((part, index) => {
    const updated = updatedAssistantContentParts[index]
    if (!updated) return
    part.tokens = updated.tokens
    part.provenanceJson = updated.provenanceJson
    part.updatedAt = updated.updatedAt
  })
  pending.toolCallParts.forEach((part, index) => {
    const updated = updatedToolCallParts[index]
    if (!updated) return
    part.tokens = updated.tokens
    part.provenanceJson = updated.provenanceJson
    part.updatedAt = updated.updatedAt
  })
  pending.toolResultParts.forEach((part, index) => {
    const updated = updatedToolResultParts[index]
    if (!updated) return
    part.tokens = updated.tokens
    part.provenanceJson = updated.provenanceJson
    part.updatedAt = updated.updatedAt
  })

  return null
}

async function ensureMcpContext(
  database: BackendDatabase,
  session: SessionRecord,
  mcpGateway: McpGateway,
): Promise<{
  sessionId: string | null
  instructions: string | null
  tools: McpToolsListResult['tools']
}> {
  if (!session.mcpProfileSnapshot) {
    throw new Error('MCP profile is required for tool-enabled turns')
  }

  const existingParts = listPartRecordsBySession(database.connection, session.id)
  const hasInstructions = existingParts.some(part => part.turnId === null && part.partType === 'mcp-instructions')
  const hasToolDefinitions = existingParts.some(part => part.turnId === null && part.partType === 'tool-definitions')

  const initialized = await mcpGateway.initializeSession(session.mcpProfileSnapshot.url)
  const toolsList = await mcpGateway.listTools(session.mcpProfileSnapshot.url, initialized.sessionId)

  const tx = database.connection.transaction(() => {
    let ordinal = getNextPartOrdinal(database.connection, session.id)

    insertRawExchangeRecord(
      database.connection,
      makeRawExchangeRecord(session.id, null, null, 'mcp-request', initialized.rawExchange, now()),
    )
    insertRawExchangeRecord(
      database.connection,
      makeRawExchangeRecord(session.id, null, null, 'mcp-response', initialized.rawExchange, now()),
    )
    insertRawExchangeRecord(
      database.connection,
      makeRawExchangeRecord(session.id, null, null, 'mcp-request', toolsList.rawExchange, now()),
    )
    insertRawExchangeRecord(
      database.connection,
      makeRawExchangeRecord(session.id, null, null, 'mcp-response', toolsList.rawExchange, now()),
    )

    if (!hasInstructions && initialized.instructions) {
      insertPartRecord(database.connection, {
        id: createUuid(),
        sessionId: session.id,
        turnId: null,
        roundId: null,
        parentPartId: null,
        ordinal: ordinal++,
        partType: 'mcp-instructions',
        roleLabel: 'system',
        payload: {
          text: `[MCP Server Instructions]\n${initialized.instructions}`,
          json: null,
          mimeType: 'text/plain',
          summary: 'MCP instructions',
        },
        display: {
          state: 'diagnostic',
          collapsedByDefault: true,
        },
        context: {
          state: 'included',
          note: 'Included as system guidance for MCP-enabled turns',
          strippedByCompactionAtTurnId: null,
        },
        tokens: {
          count: null,
          source: 'unknown',
          confidence: 'unknown',
          note: 'Session-level instructions token count not derived yet',
        },
        provenanceJson: null,
        createdAt: now(),
        updatedAt: now(),
      })
    }

    if (!hasToolDefinitions) {
      insertPartRecord(database.connection, {
        id: createUuid(),
        sessionId: session.id,
        turnId: null,
        roundId: null,
        parentPartId: null,
        ordinal: ordinal,
        partType: 'tool-definitions',
        roleLabel: 'system',
        payload: {
          text: null,
          json: toolsList.tools,
          mimeType: 'application/json',
          summary: toolsList.tools.map(tool => tool.name).join(', '),
        },
        display: {
          state: 'diagnostic',
          collapsedByDefault: true,
        },
        context: {
          state: 'included',
          note: 'Provided through the LM Studio tools array',
          strippedByCompactionAtTurnId: null,
        },
        tokens: {
          count: null,
          source: 'unknown',
          confidence: 'unknown',
          note: 'Tool definition token count not derived yet',
        },
        provenanceJson: null,
        createdAt: now(),
        updatedAt: now(),
      })
    }
  })
  tx()

  return {
    sessionId: initialized.sessionId,
    instructions: initialized.instructions ?? null,
    tools: toolsList.tools,
  }
}

function createUserPart(session: SessionRecord, turnId: string, roundId: string, ordinal: number, userContent: string, createdAt: number): PartRecord {
  return {
    id: createUuid(),
    sessionId: session.id,
    turnId,
    roundId,
    parentPartId: null,
    ordinal,
    partType: 'user-message',
    roleLabel: 'user',
    payload: {
      text: userContent,
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
    createdAt,
    updatedAt: createdAt,
  }
}

function createToolCallPart(
  session: SessionRecord,
  turnId: string,
  roundId: string,
  ordinal: number,
  toolCall: ToolCallRecord,
  createdAt: number,
): PartRecord {
  return {
    id: createUuid(),
    sessionId: session.id,
    turnId,
    roundId,
    parentPartId: null,
    ordinal,
    partType: 'tool-call',
    roleLabel: 'assistant',
    payload: {
      text: null,
      json: {
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.argumentsJson,
      },
      mimeType: 'application/json',
      summary: toolCall.name,
    },
    display: {
      state: 'transcript',
      collapsedByDefault: true,
    },
    context: {
      state: 'included',
      note: 'Tool calls are part of the assistant-visible history',
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: 'Per-tool prompt share not derived yet',
    },
    provenanceJson: null,
    createdAt,
    updatedAt: createdAt,
  }
}

function createToolResultPart(
  session: SessionRecord,
  turnId: string,
  roundId: string,
  ordinal: number,
  toolCallPartId: string,
  toolCall: ToolCallRecord,
  toolResult: McpToolCallResult,
  createdAt: number,
): PartRecord {
  return {
    id: createUuid(),
    sessionId: session.id,
    turnId,
    roundId,
    parentPartId: toolCallPartId,
    ordinal,
    partType: 'tool-result',
    roleLabel: 'tool',
    payload: {
      text: toolResult.content,
      json: toolResult.structuredContent,
      mimeType: 'application/json',
      summary: toolCall.name,
    },
    display: {
      state: 'transcript',
      collapsedByDefault: true,
    },
    context: {
      state: 'included',
      note: 'Tool results remain part of later model-visible history',
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: 'Tool result tokens not derived yet',
    },
    provenanceJson: {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      isError: toolResult.isError,
    },
    createdAt,
    updatedAt: createdAt,
  }
}

function normalizeSegmentText(text: string): string | null {
  return text.trim().length > 0 ? text : null
}

function buildReasoningPartsFromSegments(
  session: SessionRecord,
  turnId: string,
  roundId: string,
  initialOrdinal: number,
  reasoningSegments: string[],
  reasoningTokens: number | null,
  createdAt: number,
): PartRecord[] {
  if (reasoningSegments.length === 0) {
    return []
  }

  const tokenMetadata = reasoningTokens == null
    ? reasoningSegments.map(() => ({
        count: null,
        source: 'unknown' as const,
        confidence: 'unknown' as const,
        note: 'Reasoning token count was not returned by the backend',
        provenanceJson: null,
      }))
    : reasoningSegments.length === 1
      ? [{
          count: reasoningTokens,
          source: 'exact-api' as const,
          confidence: 'exact' as const,
          note: null,
          provenanceJson: { derivedFrom: 'completion.usage.reasoning_tokens' },
        }]
      : allocateProportionalTokenCounts(
          reasoningTokens,
          reasoningSegments.map(text => Math.max(1, text.length)),
        ).map(count => ({
          count,
          source: 'estimated' as const,
          confidence: 'estimated' as const,
          note: 'Allocated proportionally from the exact round reasoning token total',
          provenanceJson: {
            derivedFrom: 'completion.usage.reasoning_tokens',
            allocation: 'proportional-by-payload',
          },
        }))

  return reasoningSegments.map((reasoningText, index) => {
    const metadata = tokenMetadata[index]
    return {
      id: createUuid(),
      sessionId: session.id,
      turnId,
      roundId,
      parentPartId: null,
      ordinal: initialOrdinal + index,
      partType: 'assistant-reasoning' as const,
      roleLabel: 'assistant',
      payload: {
        text: reasoningText,
        json: null,
        mimeType: 'text/plain',
        summary: null,
      },
      display: {
        state: 'transcript' as const,
        collapsedByDefault: true,
      },
      context: {
        state: 'included' as const,
        note: 'Reasoning preserved in context for this turn; compaction will strip it after turn completion',
        strippedByCompactionAtTurnId: null,
      },
      tokens: {
        count: metadata?.count ?? null,
        source: metadata?.source ?? 'unknown',
        confidence: metadata?.confidence ?? 'unknown',
        note: metadata?.note ?? null,
      },
      provenanceJson: metadata?.provenanceJson ?? null,
      createdAt,
      updatedAt: createdAt,
    }
  })
}

function buildAssistantContentPartsFromSegments(
  session: SessionRecord,
  turnId: string,
  roundId: string,
  initialOrdinal: number,
  contentSegments: string[],
  tokenMetadata:
    | Array<{
        count: number | null
        source: PartRecord['tokens']['source']
        confidence: PartRecord['tokens']['confidence']
        note: string | null
        provenanceJson: unknown
      }>
    | null,
  createdAt: number,
  contextNote: string,
): PartRecord[] {
  return contentSegments.map((contentText, index) => {
    const metadata = tokenMetadata?.[index]
    return {
      id: createUuid(),
      sessionId: session.id,
      turnId,
      roundId,
      parentPartId: null,
      ordinal: initialOrdinal + index,
      partType: 'assistant-content' as const,
      roleLabel: 'assistant',
      payload: {
        text: contentText,
        json: null,
        mimeType: 'text/plain',
        summary: null,
      },
      display: {
        state: 'transcript' as const,
        collapsedByDefault: false,
      },
      context: {
        state: 'included' as const,
        note: contextNote,
        strippedByCompactionAtTurnId: null,
      },
      tokens: {
        count: metadata?.count ?? null,
        source: metadata?.source ?? 'unknown',
        confidence: metadata?.confidence ?? 'unknown',
        note: metadata?.note ?? 'Assistant content token allocation is pending',
      },
      provenanceJson: metadata?.provenanceJson ?? null,
      createdAt,
      updatedAt: createdAt,
    }
  })
}

function allocateAssistantContentTokenMetadata(
  contentSegments: string[],
  assistantContentTokens: number | null,
): Array<{
  count: number | null
  source: PartRecord['tokens']['source']
  confidence: PartRecord['tokens']['confidence']
  note: string | null
  provenanceJson: unknown
}> {
  if (contentSegments.length === 0) {
    return []
  }

  if (assistantContentTokens == null) {
    return contentSegments.map(() => ({
      count: null,
      source: 'unknown' as const,
      confidence: 'unknown' as const,
      note: 'Completion usage not returned by the backend',
      provenanceJson: null,
    }))
  }

  if (contentSegments.length === 1) {
    return [{
      count: assistantContentTokens,
      source: 'exact-api' as const,
      confidence: 'exact' as const,
      note: null,
      provenanceJson: { derivedFrom: 'completion.usage.completion_tokens - completion.usage.reasoning_tokens' },
    }]
  }

  return allocateProportionalTokenCounts(
    assistantContentTokens,
    contentSegments.map(text => Math.max(1, text.length)),
  ).map(count => ({
    count,
    source: 'estimated' as const,
    confidence: 'estimated' as const,
    note: 'Allocated proportionally from the exact assistant content token total',
    provenanceJson: {
      derivedFrom: 'completion.usage.completion_tokens - completion.usage.reasoning_tokens',
      allocation: 'proportional-by-payload',
    },
  }))
}

export async function createToolEnabledTurn(
  database: BackendDatabase,
  lmStudioGateway: LmStudioGateway,
  mcpGateway: McpGateway,
  input: { sessionId: string; userContent: string; maxToolRounds: number },
  emitEvent?: TurnStreamEventSink,
): Promise<RuntimeTurnResult> {
  if (input.maxToolRounds < 1) {
    throw new Error('maxToolRounds must be at least 1')
  }

  const session = getSessionRecord(database.connection, input.sessionId)
  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }
  if (!session.mcpProfileSnapshot) {
    throw new Error('MCP profile is required for tool-enabled turns')
  }

  const mcpContext = await ensureMcpContext(database, session, mcpGateway)
  const sessionParts = await ensureSessionPreludeTokenMetadata(
    database,
    lmStudioGateway,
    session,
    listPartRecordsBySession(database.connection, session.id),
  )
  const baseMessages = buildApiMessages(session, sessionParts, input.userContent)
  const lmTools = buildLmToolDefinitions(sessionParts)

  const startedAt = now()
  const turnId = createUuid()
  const userRoundId = createUuid()
  const turn: TurnRecord = {
    id: turnId,
    sessionId: session.id,
    sequenceNumber: getNextTurnSequenceNumber(database.connection, session.id),
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
  const initialRound: RoundRecord = {
    id: userRoundId,
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

  const userPart = createUserPart(session, turnId, userRoundId, getNextPartOrdinal(database.connection, session.id), input.userContent, startedAt)
  const initializeTx = database.connection.transaction(() => {
    insertTurnRecord(database.connection, turn)
    insertRoundRecord(database.connection, initialRound)
    insertPartRecord(database.connection, userPart)
  })
  initializeTx()
  emitEvent?.({
    type: 'turn-started',
    turn: { ...turn },
  })
  emitEvent?.({
    type: 'round-started',
    round: { ...initialRound },
  })

  const rounds: RoundRecord[] = []
  let requestMessages: ApiMessage[] = baseMessages
  let currentRound = initialRound
  let pendingPromptSuffix: PendingPromptSuffixAttribution | null = {
    kind: 'user-message',
    baseMessageCount: Math.max(0, requestMessages.length - 1),
    userPart,
  }

  for (let roundIndex = 0; roundIndex < input.maxToolRounds; roundIndex++) {
    const requestBody: Record<string, unknown> = {
      model: session.modelProfileSnapshot.modelKey,
      temperature: session.modelProfileSnapshot.temperature,
      stream: true,
      stream_options: {
        include_usage: true,
      },
      messages: requestMessages,
      tools: lmTools,
      ...(session.modelProfileSnapshot.reasoning ? { reasoning: session.modelProfileSnapshot.reasoning } : {}),
    }

    currentRound.requestPayloadJson = requestBody
    updateRoundRecord(database.connection, currentRound)

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
            roundId: currentRound.id,
            delta,
          })
        },
      },
    )
    const completion = streamedCompletion.completion

    const completedAt = now()
    const finishReason = completion.choices[0]?.finish_reason
    const usage = normalizeLmStudioUsageFromResponse(completion)

    currentRound.status = 'complete'
    currentRound.finishReason = finishReason === 'tool_calls' ? 'tool_calls' : 'stop'
    currentRound.completedAt = completedAt
    currentRound.usage = {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
    }
    currentRound.responseTraceJson = {
      completion,
      assistantSegments: streamedCompletion.segments,
    }
    rounds.push({ ...currentRound })

    // applyPendingPromptSuffixAttribution always returns null — called for DB side-effects only
    await applyPendingPromptSuffixAttribution(
      database,
      lmStudioGateway,
      session,
      requestMessages,
      lmTools,
      usage.promptTokens,
      sessionParts,
      pendingPromptSuffix,
    )

    const rawExchanges = createLmStudioRawExchange(
      session,
      turnId,
      currentRound.id,
      requestBody,
      streamedCompletion.rawResponseBody,
      currentRound.startedAt,
      completedAt,
    )

    if (finishReason === 'tool_calls') {
      const toolCalls = parseToolCalls(currentRound, completion)
      const toolCallByIndex = new Map(toolCalls.map((toolCall, index) => [index, toolCall]))
      const reasoningSegments = streamedCompletion.segments
        .filter((segment): segment is { kind: 'reasoning'; text: string } => segment.kind === 'reasoning')
        .map(segment => normalizeSegmentText(segment.text))
        .filter((text): text is string => text !== null)
      const reasoningParts = buildReasoningPartsFromSegments(
        session,
        turnId,
        currentRound.id,
        getNextPartOrdinal(database.connection, session.id),
        reasoningSegments,
        usage.reasoningTokens,
        completedAt,
      )
      const reasoningPartsQueue = [...reasoningParts]
      const assistantContentSegments = streamedCompletion.segments
        .filter((segment): segment is { kind: 'content'; text: string } => segment.kind === 'content')
        .map(segment => normalizeSegmentText(segment.text))
        .filter((text): text is string => text !== null)
      const assistantContentParts = buildAssistantContentPartsFromSegments(
        session,
        turnId,
        currentRound.id,
        getNextPartOrdinal(database.connection, session.id) + reasoningParts.length,
        assistantContentSegments,
        assistantContentSegments.map(() => ({
          count: null,
          source: 'unknown' as const,
          confidence: 'unknown' as const,
          note: 'Assistant content shared a tool-call message; prompt delta allocation is pending',
          provenanceJson: null,
        })),
        completedAt,
        'Assistant content shared a tool-call message and remains part of later model-visible history',
      )
      const assistantContentPartsQueue = [...assistantContentParts]
      const toolCallPartsByIndex = new Map<number, PartRecord>()
      const toolResultParts: PartRecord[] = []
      const assistantMessageParts: PartRecord[] = []
      let ordinal = getNextPartOrdinal(database.connection, session.id)

      for (const segment of streamedCompletion.segments) {
        if (segment.kind === 'reasoning') {
          const part = reasoningPartsQueue.shift()
          if (!part) {
            continue
          }
          part.ordinal = ordinal++
          assistantMessageParts.push(part)
          continue
        }

        if (segment.kind === 'content') {
          const part = assistantContentPartsQueue.shift()
          if (!part) {
            continue
          }
          part.ordinal = ordinal++
          assistantMessageParts.push(part)
          continue
        }

        const toolCall = toolCallByIndex.get(segment.toolCallIndex)
        if (!toolCall || toolCallPartsByIndex.has(segment.toolCallIndex)) {
          continue
        }

        const toolCallPart = createToolCallPart(session, turnId, currentRound.id, ordinal++, toolCall, completedAt)
        toolCallPartsByIndex.set(segment.toolCallIndex, toolCallPart)
        assistantMessageParts.push(toolCallPart)
      }

      const toolCallParts = [...toolCallPartsByIndex.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, part]) => part)

      let toolResultOrdinal = ordinal
      for (const toolCallPart of toolCallParts) {
        const toolJson = toolCallPart.payload.json as { id?: string; name?: string; arguments?: string } | null
        const toolCall = {
          id: toolJson?.id ?? toolCallPart.id,
          name: toolJson?.name ?? 'unknown',
          argumentsJson: toolJson?.arguments ?? '{}',
        }
        const parsedArgs = JSON.parse(toolCall.argumentsJson || '{}') as Record<string, unknown>
        const toolResult = await mcpGateway.callTool(
          session.mcpProfileSnapshot.url,
          mcpContext.sessionId,
          toolCall.name,
          parsedArgs,
        )
        const toolResultPart = createToolResultPart(
          session,
          turnId,
          currentRound.id,
          toolResultOrdinal++,
          toolCallPart.id,
          toolCall,
          toolResult,
          now(),
        )
        toolResultParts.push(toolResultPart)

        insertRawExchangeRecord(database.connection, makeRawExchangeRecord(session.id, turnId, currentRound.id, 'mcp-request', toolResult.rawExchange, now()))
        insertRawExchangeRecord(database.connection, makeRawExchangeRecord(session.id, turnId, currentRound.id, 'mcp-response', toolResult.rawExchange, now()))
      }

      const toolTx = database.connection.transaction(() => {
        updateRoundRecord(database.connection, currentRound)
        rawExchanges.forEach(exchange => insertRawExchangeRecord(database.connection, exchange))
        assistantMessageParts.forEach(part => insertPartRecord(database.connection, part))
        toolResultParts.forEach(part => insertPartRecord(database.connection, part))
      })
      toolTx()
      assistantMessageParts.forEach(part => emitEvent?.({
        type: 'part-committed',
        part,
      }))
      toolResultParts.forEach(part => emitEvent?.({
        type: 'part-committed',
        part,
      }))
      emitEvent?.({
        type: 'round-committed',
        round: { ...currentRound },
      })

      const baseMessageCount = requestMessages.length
      requestMessages = [
        ...requestMessages,
        {
          role: 'assistant',
          content: assistantContentParts.map(part => part.payload.text ?? '').join('') || null,
          tool_calls: toolCalls.map(toolCall => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.argumentsJson,
            },
          })),
        },
        ...toolResultParts.map(part => ({
          role: 'tool' as const,
          content: part.payload.text,
          tool_call_id: (part.provenanceJson as { toolCallId?: string } | null)?.toolCallId ?? part.parentPartId ?? part.id,
        })),
      ]
      pendingPromptSuffix = {
        kind: 'tool-cycle',
        baseMessageCount,
        assistantContentParts,
        toolCallParts,
        toolResultParts,
      }

      currentRound = {
        id: createUuid(),
        turnId,
        roundIndex: currentRound.roundIndex + 1,
        status: 'streaming',
        finishReason: null,
        startedAt: now(),
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
      insertRoundRecord(database.connection, currentRound)
      emitEvent?.({
        type: 'round-started',
        round: { ...currentRound },
      })
      continue
    }

    const reasoningSegments = streamedCompletion.segments
      .filter((segment): segment is { kind: 'reasoning'; text: string } => segment.kind === 'reasoning')
      .map(segment => normalizeSegmentText(segment.text))
      .filter((text): text is string => text !== null)
    const assistantContentSegments = streamedCompletion.segments
      .filter((segment): segment is { kind: 'content'; text: string } => segment.kind === 'content')
      .map(segment => normalizeSegmentText(segment.text))
      .filter((text): text is string => text !== null)

    const reasoningParts = buildReasoningPartsFromSegments(
      session,
      turnId,
      currentRound.id,
      getNextPartOrdinal(database.connection, session.id),
      reasoningSegments,
      usage.reasoningTokens,
      completedAt,
    )
    const assistantContentParts = buildAssistantContentPartsFromSegments(
      session,
      turnId,
      currentRound.id,
      getNextPartOrdinal(database.connection, session.id) + reasoningParts.length,
      assistantContentSegments,
      allocateAssistantContentTokenMetadata(assistantContentSegments, usage.assistantContentTokens),
      completedAt,
      'Assistant answer remains part of later model-visible history',
    )
    const reasoningPartsQueue = [...reasoningParts]
    const assistantContentPartsQueue = [...assistantContentParts]
    const assistantParts: PartRecord[] = []
    let ordinal = getNextPartOrdinal(database.connection, session.id)

    for (const segment of streamedCompletion.segments) {
      if (segment.kind === 'reasoning') {
        const part = reasoningPartsQueue.shift()
        if (!part) {
          continue
        }
        part.ordinal = ordinal++
        assistantParts.push(part)
        continue
      }

      if (segment.kind === 'content') {
        const part = assistantContentPartsQueue.shift()
        if (!part) {
          continue
        }
        part.ordinal = ordinal++
        assistantParts.push(part)
      }
    }

    turn.status = 'complete'
    turn.completedAt = completedAt
    turn.outcome = currentRound.roundIndex > 0 ? 'tool-assisted-response' : 'model-response'
    turn.usage = { ...currentRound.usage }

    session.status = 'active'
    session.updatedAt = completedAt
    session.title = turn.sequenceNumber === 1 ? input.userContent.slice(0, 60) || session.title : session.title

    const finalizeTx = database.connection.transaction(() => {
      updateRoundRecord(database.connection, currentRound)
      rawExchanges.forEach(exchange => insertRawExchangeRecord(database.connection, exchange))
      assistantParts.forEach(part => insertPartRecord(database.connection, part))
      updateTurnRecord(database.connection, turn)
      updateSessionRecord(database.connection, session)
    })
    finalizeTx()

    // Apply context compaction (e.g. strip reasoning) now that the turn is fully persisted.
    const compactedTurn = applyContextCompaction(database.connection, turn, session.compactionStrategy)
    Object.assign(turn, compactedTurn)

    assistantParts.forEach(part => emitEvent?.({
      type: 'part-committed',
      part,
    }))
    emitEvent?.({
      type: 'round-committed',
      round: { ...currentRound },
    })

    const persistedParts = listPartRecordsBySession(database.connection, session.id)
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
      round: currentRound,
      rounds,
      parts: persistedParts.filter(part => part.turnId === turnId),
      transcript: trace.transcript,
      context: trace.context,
    }
  }

  throw new Error(`Stopped after ${input.maxToolRounds} tool rounds`)
}
