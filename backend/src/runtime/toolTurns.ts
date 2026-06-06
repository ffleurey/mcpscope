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
  getNextPreludePartSequence,
  getNextPartOrdinal,
  getNextRoundPartSequence,
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
import { formatPartId, formatRoundId, formatSetupPartId, formatTurnId } from '../domain/hierarchicalIds.js'
import { sessionReasoningBody, type ChatCompletionGateway, type RuntimeTurnResult } from './modelTurns.js'
import type { ApiMessage } from '../domain/selectors.js'
import type { McpRawExchange, McpToolCallResult, McpToolsListResult } from '../services/mcp/httpClient.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import {
  allocateProportionalTokenCounts,
  deriveExactDeltaTokenMetadata,
  normalizeUsageFromResponse,
} from '../domain/tokenAccounting.js'
import {
  deriveExactToolPreludeTokens,
  ensureSessionPreludeTokenMetadata,
} from './sessionPrelude.js'
import { probeRequestPromptTokens } from './promptTokenProbing.js'
import { applyContextCompaction } from '../domain/compaction.js'
import { executeChatCompletion } from './streamedCompletion.js'
import type { TurnStreamEventSink } from './streamEvents.js'
import { maybeApplyAutomaticSessionTitle } from './sessionTitles.js'

export interface McpGateway {
  initializeSession(serverUrl: string): Promise<{
    sessionId: string | null
    instructions?: string | undefined
    rawExchange: McpRawExchange
  }>
  listTools(serverUrl: string, sessionId: string | null): Promise<McpToolsListResult>
  callTool(serverUrl: string, sessionId: string | null, name: string, args: Record<string, unknown>): Promise<McpToolCallResult>
}

export interface McpServerContext {
  sessionId: string | null
  instructions: string | null
}

export interface McpContextResult {
  serverContexts: Map<string, McpServerContext>
  tools: McpToolsListResult['tools']
  toolServerMap: Map<string, string>
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
      // completion_tokens - reasoning_tokens for the round that generated the tool calls.
      // Used to attribute tool-call message cost when tool results are present — probing the
      // assistant message directly returns 0 because LM Studio does not count the tool_calls
      // field of assistant messages in prompt probes.
      assistantContentTokens: number | null
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

function parseToolCalls(round: RoundRecord, response: Awaited<ReturnType<ChatCompletionGateway['createChatCompletion']>>): ToolCallRecord[] {
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

function estimateTokenCountFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function estimateDeterministicToolCallTokens(toolCall: ToolCallRecord): PartRecord['tokens'] {
  return {
    count: estimateTokenCountFromText(JSON.stringify({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.argumentsJson,
    })),
    source: 'estimated',
    confidence: 'estimated',
    note: 'Estimated from deterministic tool-call payload size',
  }
}

function estimateDeterministicToolResultTokens(toolResult: McpToolCallResult): PartRecord['tokens'] {
  const serialized = toolResult.content
    ?? (toolResult.structuredContent == null ? '' : JSON.stringify(toolResult.structuredContent))
  return {
    count: estimateTokenCountFromText(serialized),
    source: 'estimated',
    confidence: 'estimated',
    note: 'Estimated from deterministic tool-result payload size',
  }
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
  chatCompletionGateway: ChatCompletionGateway,
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
      ? await probeRequestPromptTokens(chatCompletionGateway, session, prefixMessages, lmTools, {
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
  const prefixTokens = await probeRequestPromptTokens(chatCompletionGateway, session, prefixMessages, lmTools, traceContext)
  if (prefixTokens == null) {
    return null
  }

  // Determine the token budget for the assistant message (tool calls + any text content).
  //
  // When there are NO tool results, the next round's promptTokens covers exactly
  // [prefix + assistant{tool_calls}], so the delta is exact.
  //
  // When there ARE tool results, probing the assistant message returns 0 — LM Studio does
  // not count the `tool_calls` field of assistant messages in prompt probes. We therefore
  // use `completion_tokens − reasoning_tokens` from the round that generated the tool calls
  // as a proxy. This is the generation cost, which approximates the re-consumption cost;
  // the delta is the chat-template overhead for the assistant message (~3–5 tokens), which
  // we cannot recover without a working probe.
  const hasToolResults = pending.toolResultParts.length > 0
  const toolCallGroupTokens = hasToolResults
    ? Math.max(0, pending.assistantContentTokens ?? 0)
    : Math.max(0, (promptTokens ?? 0) - prefixTokens)

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

  // Confidence for the tool-call message attribution:
  // - Exact when: no tool results (delta is exact) + single tool call + no text content.
  // - exact-api when: tool results present + single tool call + no text (uses completion_tokens directly).
  // - Estimated otherwise: multiple parts or multiple tool calls (proportional allocation).
  const singleExactCase = !hasToolResults && pending.assistantContentParts.length === 0 && pending.toolCallParts.length === 1
  const singleApiCase = hasToolResults && pending.assistantContentParts.length === 0 && pending.toolCallParts.length === 1
  const updatedAssistantContentParts = pending.assistantContentParts.map((part, index) => updatePartTokens(
        part,
        {
          count: groupedAllocations[index] ?? 0,
          source: 'estimated',
          confidence: 'estimated',
          note: hasToolResults
            ? 'Allocated proportionally from completion_tokens (tool results present; prompt probe returns 0 for tool_calls)'
            : 'Allocated proportionally from the exact grouped assistant message prompt delta',
        },
        { derivedFrom: hasToolResults ? 'completion.usage.assistant-content-tokens' : 'lmstudio.prompt_tokens.assistant-tool-message-delta', allocation: 'proportional-by-payload' },
        updatedAt,
      ))
  const toolCallAllocationOffset = pending.assistantContentParts.length
  const updatedToolCallParts = pending.toolCallParts.map((part, index) => {
    const count = groupedAllocations[index + toolCallAllocationOffset] ?? 0
    return updatePartTokens(
      part,
      singleExactCase
        ? {
            count,
            source: 'delta-derived',
            confidence: 'exact',
            note: 'Derived as exact prompt delta for the assistant tool-call message',
          }
        : singleApiCase
          ? {
              count,
              source: 'exact-api',
              confidence: 'estimated',
              note: 'Derived from completion_tokens (generation cost; chat-template overhead ~3–5 tokens attributed to tool results)',
            }
          : {
              count,
              source: 'estimated',
              confidence: 'estimated',
              note: hasToolResults
                ? 'Allocated proportionally from completion_tokens (generation cost; chat-template overhead applies)'
                : 'Allocated proportionally from the exact grouped assistant tool-call prompt delta',
            },
      singleExactCase
        ? { derivedFrom: 'lmstudio.prompt_tokens.tool-call-delta' }
        : singleApiCase
          ? { derivedFrom: 'completion.usage.assistant-content-tokens' }
          : { derivedFrom: hasToolResults ? 'completion.usage.assistant-content-tokens' : 'lmstudio.prompt_tokens.assistant-tool-message-delta', allocation: 'proportional-by-payload' },
      updatedAt,
    )
  })

  // Tool result attribution: allocate the remaining budget proportionally.
  // Total = promptTokens − prefixTokens − toolCallGroupTokens (conserved exactly).
  // Individual splits are proportional by content length → confidence: estimated.
  // This avoids per-result probes, which also suffered from the assistant-message blind spot.
  const totalToolResultTokens = promptTokens == null
    ? null
    : Math.max(0, promptTokens - prefixTokens - toolCallGroupTokens)
  const toolResultWeights = pending.toolResultParts.map(p => Math.max(1, (p.payload.text ?? '').length))
  const toolResultAllocations = totalToolResultTokens == null || pending.toolResultParts.length === 0
    ? pending.toolResultParts.map(() => null)
    : pending.toolResultParts.length === 1
      ? [totalToolResultTokens]
      : allocateProportionalTokenCounts(totalToolResultTokens, toolResultWeights)

  const updatedToolResultParts: PartRecord[] = pending.toolResultParts.map((part, index) => {
    const count = toolResultAllocations[index]
    return updatePartTokens(
      part,
      count == null
        ? { count: null, source: 'unknown', confidence: 'unknown', note: 'Prompt token total was not available' }
        : {
            count,
            source: 'estimated',
            confidence: 'estimated',
            note: pending.toolResultParts.length === 1
              ? 'Derived as total tool-result context budget (promptTokens − prefix − assistantMessage)'
              : 'Allocated proportionally from total tool-result context budget (promptTokens − prefix − assistantMessage)',
          },
      { derivedFrom: 'lmstudio.prompt_tokens.tool-result-proportional' },
      updatedAt,
    )
  })

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

export async function ensureMcpContext(
  database: BackendDatabase,
  session: SessionRecord,
  mcpGateway: McpGateway,
  logger?: { warn: (msg: string) => void },
): Promise<McpContextResult> {
  if (session.mcpProfileSnapshots.length === 0) {
    throw new Error('MCP profile is required for tool-enabled turns')
  }

  const existingParts = listPartRecordsBySession(database.connection, session.id)
  const hasInstructions = existingParts.some(part => part.turnId === null && part.partType === 'mcp-instructions')
  const hasToolDefinitions = existingParts.some(part => part.turnId === null && part.partType === 'tool-definitions')

  const serverContexts = new Map<string, McpServerContext>()
  const combinedTools: McpToolsListResult['tools'] = []
  const toolServerMap = new Map<string, string>()
  const instructionsBuilder: string[] = []
  type PendingRawExchange = { kind: 'init' | 'tools', exchange: McpRawExchange }

  const pendingRawExchanges: Array<{ init: PendingRawExchange; tools: PendingRawExchange }> = []

  for (const profile of session.mcpProfileSnapshots) {
    const initialized = await mcpGateway.initializeSession(profile.url)
    const toolsList = await mcpGateway.listTools(profile.url, initialized.sessionId)

    serverContexts.set(profile.url, {
      sessionId: initialized.sessionId,
      instructions: initialized.instructions ?? null,
    })

    pendingRawExchanges.push({
      init: { kind: 'init', exchange: initialized.rawExchange },
      tools: { kind: 'tools', exchange: toolsList.rawExchange },
    })

    if (initialized.instructions) {
      instructionsBuilder.push(`[${profile.name}]\n${initialized.instructions}`)
    }

    for (const tool of toolsList.tools) {
      if (toolServerMap.has(tool.name)) {
        const warnFn = logger?.warn ?? console.warn
        warnFn(
          `Tool name collision: "${tool.name}" provided by both "${toolServerMap.get(tool.name)}" and "${profile.url}". Using first server.`,
        )
      } else {
        toolServerMap.set(tool.name, profile.url)
        combinedTools.push(tool)
      }
    }
  }

  const nowTs = now()

  database.connection.transaction(() => {
    for (const { init, tools } of pendingRawExchanges) {
      insertRawExchangeRecord(
        database.connection,
        makeRawExchangeRecord(session.id, null, null, 'mcp-request', init.exchange, nowTs),
      )
      insertRawExchangeRecord(
        database.connection,
        makeRawExchangeRecord(session.id, null, null, 'mcp-response', init.exchange, nowTs),
      )
      insertRawExchangeRecord(
        database.connection,
        makeRawExchangeRecord(session.id, null, null, 'mcp-request', tools.exchange, nowTs),
      )
      insertRawExchangeRecord(
        database.connection,
        makeRawExchangeRecord(session.id, null, null, 'mcp-response', tools.exchange, nowTs),
      )
    }

    if (!hasInstructions && instructionsBuilder.length > 0) {
      let ordinal = getNextPartOrdinal(database.connection, session.id)
      let preludePartNumber = getNextPreludePartSequence(database.connection, session.id)

      insertPartRecord(database.connection, {
        id: formatSetupPartId(session.id, preludePartNumber++, 'mcp-instructions'),
        sessionId: session.id,
        turnId: null,
        roundId: null,
        parentPartId: null,
        ordinal: ordinal++,
        partType: 'mcp-instructions',
        roleLabel: 'system',
        payload: {
          text: instructionsBuilder.join('\n\n'),
          json: null,
          mimeType: 'text/plain',
          summary: `MCP instructions (${session.mcpProfileSnapshots.length} server(s))`,
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
        createdAt: nowTs,
        updatedAt: nowTs,
      })
    }

    if (!hasToolDefinitions) {
      let ordinal = getNextPartOrdinal(database.connection, session.id)
      let preludePartNumber = getNextPreludePartSequence(database.connection, session.id)

      insertPartRecord(database.connection, {
        id: formatSetupPartId(session.id, preludePartNumber, 'tool-definitions'),
        sessionId: session.id,
        turnId: null,
        roundId: null,
        parentPartId: null,
        ordinal: ordinal,
        partType: 'tool-definitions',
        roleLabel: 'system',
        payload: {
          text: null,
          json: combinedTools,
          mimeType: 'application/json',
          summary: combinedTools.map(tool => tool.name).join(', '),
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
        createdAt: nowTs,
        updatedAt: nowTs,
      })
    }
  })()

  return {
    serverContexts,
    tools: combinedTools,
    toolServerMap,
  }
}

function createUserPart(
  session: SessionRecord,
  partId: string,
  turnId: string,
  roundId: string,
  ordinal: number,
  userContent: string,
  createdAt: number,
): PartRecord {
  return {
    id: partId,
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
  partId: string,
  turnId: string,
  roundId: string,
  ordinal: number,
  toolCall: ToolCallRecord,
  createdAt: number,
): PartRecord {
  return {
    id: partId,
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
  partId: string,
  turnId: string,
  roundId: string,
  ordinal: number,
  toolCallPartId: string,
  toolCall: ToolCallRecord,
  toolResult: McpToolCallResult,
  createdAt: number,
): PartRecord {
  return {
    id: partId,
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

/**
 * Runs a single MCP tool call deterministically (without an LLM deciding to call it).
 * Writes a complete turn (user-message → tool-call → tool-result) into the session so
 * that subsequent LLM turns see the result as prior context.
 *
 * Used by orchestration step implementations (e.g. bootstrap) to inject tool evidence
 * into the session context without waiting for the LLM to decide to call the tool.
 */
export async function runDeterministicMcpToolCall(
  database: BackendDatabase,
  mcpGateway: McpGateway,
  session: SessionRecord,
  toolName: string,
  toolArgs: Record<string, unknown>,
  userContextMessage: string | null,
  emitEvent?: TurnStreamEventSink,
  reservedTurnId?: string,
  roundIndexOverride?: number,
  commitTurn = true,
  ownerStepId?: string | null,
): Promise<{
  turnId: string
  roundId: string
  userPartId: string | null
  toolCallPartId: string
  toolResultPartId: string
  resultContent: string
}> {
  if (session.mcpProfileSnapshots.length === 0) {
    throw new Error('MCP profile is required for deterministic tool calls')
  }
  const deterministicToolServerMap = new Map<string, string>()
  for (const profile of session.mcpProfileSnapshots) {
    for (const tool of (await mcpGateway.listTools(profile.url, null)).tools) {
      if (!deterministicToolServerMap.has(tool.name)) {
        deterministicToolServerMap.set(tool.name, profile.url)
      }
    }
  }
  const serverUrl = deterministicToolServerMap.get(toolName)
  if (!serverUrl) {
    throw new Error(`No MCP server found for tool "${toolName}"`)
  }
  const ts = now()
  const turnNumber = reservedTurnId
    ? parseInt((reservedTurnId.split('.').at(-1) ?? '1').replace('T', ''), 10) || 1
    : getNextTurnNumber(database.connection, session.id, ownerStepId ?? null)
  const turnId = reservedTurnId ?? formatTurnId(session.id, turnNumber, ownerStepId ?? null)
  const roundNumber = (roundIndexOverride ?? 0) + 1
  const roundId = formatRoundId(session.id, turnNumber, roundNumber, ownerStepId ?? null)

  const userPartOrdinal = getNextPartOrdinal(database.connection, session.id)
  const nextRoundPartSequence = getNextRoundPartSequence(database.connection, roundId)
  const userPartId = userContextMessage
    ? formatPartId(session.id, turnNumber, roundNumber, nextRoundPartSequence, 'user-message', ownerStepId ?? null)
    : null
  const toolCallPartId = formatPartId(
    session.id,
    turnNumber,
    roundNumber,
    nextRoundPartSequence + (userContextMessage ? 1 : 0),
    'tool-call',
    ownerStepId ?? null,
  )
  const toolResultPartId = formatPartId(
    session.id,
    turnNumber,
    roundNumber,
    nextRoundPartSequence + (userContextMessage ? 2 : 1),
    'tool-result',
    ownerStepId ?? null,
  )

  const toolCallId = createUuid()
  const toolCall: ToolCallRecord = {
    id: toolCallId,
    name: toolName,
    argumentsJson: JSON.stringify(toolArgs),
  }

  const turn: TurnRecord = reservedTurnId
    ? {
        ...(listTurnRecordsBySession(database.connection, session.id).find(t => t.id === turnId) ?? {
          id: turnId,
          sessionId: session.id,
          ownerStepId: ownerStepId ?? null,
          turnNumber,
          status: 'streaming',
          outcome: null,
          usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
          contextTokensAtTurnEnd: null,
          contextTokensAfterCompaction: null,
          compactionApplied: 'none',
          compactionTokensRemoved: null,
          createdAt: ts,
          completedAt: null,
        }),
      }
    : {
        id: turnId,
        sessionId: session.id,
      ownerStepId: ownerStepId ?? null,
        turnNumber,
        status: 'streaming',
        outcome: null,
        usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
        contextTokensAtTurnEnd: null,
        contextTokensAfterCompaction: null,
        compactionApplied: 'none',
        compactionTokensRemoved: null,
        createdAt: ts,
        completedAt: null,
      }
  const round: RoundRecord = {
    id: roundId,
    turnId,
    roundIndex: roundNumber - 1,
    status: 'streaming',
    finishReason: 'tool_calls',
    usage: { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null },
    requestPayloadJson: null,
    responseTraceJson: null,
    startedAt: ts,
    completedAt: null,
  }
  const userPart = userPartId && userContextMessage
    ? createUserPart(session, userPartId, turnId, roundId, userPartOrdinal, userContextMessage, ts)
    : null
  const toolCallOrdinal = userPart ? userPartOrdinal + 1 : userPartOrdinal
  const toolResultOrdinal = toolCallOrdinal + 1
  const toolCallPart = createToolCallPart(session, toolCallPartId, turnId, roundId, toolCallOrdinal, toolCall, ts)
  toolCallPart.tokens = estimateDeterministicToolCallTokens(toolCall)
  toolCallPart.provenanceJson = {
    ...(toolCallPart.provenanceJson as Record<string, unknown> | null ?? {}),
    derivedFrom: 'deterministic-tool-call-payload-estimate',
  }

  database.connection.transaction(() => {
    if (!reservedTurnId) {
      insertTurnRecord(database.connection, turn)
    } else {
      updateTurnRecord(database.connection, turn)
    }
    insertRoundRecord(database.connection, round)
    if (userPart) insertPartRecord(database.connection, userPart)
    insertPartRecord(database.connection, toolCallPart)
  })()

  if (!reservedTurnId) {
    emitEvent?.({ type: 'turn-started', turn: { ...turn } })
  }
  emitEvent?.({ type: 'round-started', round: { ...round } })
  if (userPart) emitEvent?.({ type: 'part-committed', part: { ...userPart } })
  emitEvent?.({ type: 'part-committed', part: { ...toolCallPart } })

  // Perform the actual MCP tool call
  const mcpSession = await mcpGateway.initializeSession(serverUrl)
  const toolResult = await mcpGateway.callTool(
    serverUrl,
    mcpSession.sessionId,
    toolName,
    toolArgs,
  )

  const completedAt = now()
  const toolResultPart = createToolResultPart(
    session,
    toolResultPartId,
    turnId,
    roundId,
    toolResultOrdinal,
    toolCallPartId,
    toolCall,
    toolResult,
    completedAt,
  )
  toolResultPart.tokens = estimateDeterministicToolResultTokens(toolResult)
  toolResultPart.provenanceJson = {
    ...(toolResultPart.provenanceJson as Record<string, unknown> | null ?? {}),
    derivedFrom: 'deterministic-tool-result-payload-estimate',
  }

  turn.status = 'complete'
  turn.outcome = 'deterministic-tool-call'
  turn.completedAt = completedAt

  round.status = 'complete'
  round.completedAt = completedAt

  database.connection.transaction(() => {
    updateTurnRecord(database.connection, turn)
    updateRoundRecord(database.connection, round)
    insertPartRecord(database.connection, toolResultPart)
    insertRawExchangeRecord(database.connection, makeRawExchangeRecord(session.id, turnId, roundId, 'mcp-request', mcpSession.rawExchange, ts))
    insertRawExchangeRecord(database.connection, makeRawExchangeRecord(session.id, turnId, roundId, 'mcp-response', mcpSession.rawExchange, ts))
    insertRawExchangeRecord(database.connection, makeRawExchangeRecord(session.id, turnId, roundId, 'mcp-request', toolResult.rawExchange, completedAt))
    insertRawExchangeRecord(database.connection, makeRawExchangeRecord(session.id, turnId, roundId, 'mcp-response', toolResult.rawExchange, completedAt))
  })()

  emitEvent?.({ type: 'part-committed', part: { ...toolResultPart } })
  emitEvent?.({ type: 'round-committed', round: { ...round } })

  const persistedParts = listPartRecordsBySession(database.connection, session.id)
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
  if (commitTurn) {
    emitEvent?.({ type: 'turn-committed', turn: { ...turn }, trace })
  }

  return {
    turnId,
    roundId,
    userPartId,
    toolCallPartId,
    toolResultPartId,
    resultContent: toolResult.content,
  }
}

export async function runDeterministicMcpToolCallsInSingleTurn(
  database: BackendDatabase,
  mcpGateway: McpGateway,
  session: SessionRecord,
  calls: Array<{ toolName: string; toolArgs: Record<string, unknown> }>,
  emitEvent?: TurnStreamEventSink,
  ownerStepId?: string | null,
): Promise<{ turnId: string; toolCallPartIds: string[]; toolResultPartIds: string[] }> {
  const toolCallPartIds: string[] = []
  const toolResultPartIds: string[] = []

  let reservedTurnId: string | null = null

  for (const [index, call] of calls.entries()) {
    const result = await runDeterministicMcpToolCall(
      database,
      mcpGateway,
      session,
      call.toolName,
      call.toolArgs,
      null,
      emitEvent,
      reservedTurnId ?? undefined,
      index,
      index === calls.length - 1,
      ownerStepId,
    )
    reservedTurnId = result.turnId
    toolCallPartIds.push(result.toolCallPartId)
    toolResultPartIds.push(result.toolResultPartId)
  }

  if (!reservedTurnId) {
    throw new Error('Expected at least one deterministic MCP call')
  }

  return {
    turnId: reservedTurnId,
    toolCallPartIds,
    toolResultPartIds,
  }
}

export async function createToolEnabledTurn(
  database: BackendDatabase,
  chatCompletionGateway: ChatCompletionGateway,
  mcpGateway: McpGateway,
  input: { sessionId: string; userContent: string; maxToolRounds: number; ownerStepId?: string | null | undefined; reservedTurn?: TurnRecord | undefined },
  emitEvent?: TurnStreamEventSink,
): Promise<RuntimeTurnResult> {
  if (input.maxToolRounds < 1) {
    throw new Error('maxToolRounds must be at least 1')
  }

  const session = getSessionRecord(database.connection, input.sessionId)
  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }
  if (session.mcpProfileSnapshots.length === 0) {
    throw new Error('MCP profile is required for tool-enabled turns')
  }

  const mcpContext = await ensureMcpContext(database, session, mcpGateway)
  const sessionParts = await ensureSessionPreludeTokenMetadata(
    database,
    chatCompletionGateway,
    session,
    listPartRecordsBySession(database.connection, session.id),
  )
  const baseMessages = buildApiMessages(session, sessionParts, input.userContent)
  const lmTools = buildLmToolDefinitions(sessionParts)

  const startedAt = input.reservedTurn?.createdAt ?? now()
  const turnNumber = input.reservedTurn?.turnNumber
    ?? getNextTurnNumber(database.connection, session.id, input.ownerStepId ?? null)
  const turnId = input.reservedTurn?.id
    ?? formatTurnId(session.id, turnNumber, input.ownerStepId ?? null)
  const userRoundId = formatRoundId(session.id, turnNumber, 1, input.ownerStepId ?? null)
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

  const userPart = createUserPart(
    session,
    formatPartId(session.id, turnNumber, 1, getNextRoundPartSequence(database.connection, userRoundId), 'user-message', input.ownerStepId ?? null),
    turnId,
    userRoundId,
    getNextPartOrdinal(database.connection, session.id),
    input.userContent,
    startedAt,
  )
  const initializeTx = database.connection.transaction(() => {
    if (!input.reservedTurn) {
      insertTurnRecord(database.connection, turn)
    }
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
      ...sessionReasoningBody(session),
    }

    currentRound.requestPayloadJson = requestBody
    updateRoundRecord(database.connection, currentRound)

    const streamedCompletion = await executeChatCompletion(
      chatCompletionGateway,
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
    const usage = normalizeUsageFromResponse(completion)

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
      chatCompletionGateway,
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
      let partNumber = getNextRoundPartSequence(database.connection, currentRound.id)

      for (const segment of streamedCompletion.segments) {
        if (segment.kind === 'reasoning') {
          const part = reasoningPartsQueue.shift()
          if (!part) {
            continue
          }
          part.id = formatPartId(session.id, turnNumber, currentRound.roundIndex + 1, partNumber++, 'assistant-reasoning', input.ownerStepId ?? null)
          part.ordinal = ordinal++
          assistantMessageParts.push(part)
          continue
        }

        if (segment.kind === 'content') {
          const part = assistantContentPartsQueue.shift()
          if (!part) {
            continue
          }
          part.id = formatPartId(session.id, turnNumber, currentRound.roundIndex + 1, partNumber++, 'assistant-content', input.ownerStepId ?? null)
          part.ordinal = ordinal++
          assistantMessageParts.push(part)
          continue
        }

        const toolCall = toolCallByIndex.get(segment.toolCallIndex)
        if (!toolCall || toolCallPartsByIndex.has(segment.toolCallIndex)) {
          continue
        }

        const toolCallPart = createToolCallPart(
          session,
          formatPartId(session.id, turnNumber, currentRound.roundIndex + 1, partNumber++, 'tool-call', input.ownerStepId ?? null),
          turnId,
          currentRound.id,
          ordinal++,
          toolCall,
          completedAt,
        )
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
        const serverUrl = mcpContext.toolServerMap.get(toolCall.name)
        if (!serverUrl) throw new Error(`No MCP server found for tool "${toolCall.name}"`)
        const serverCtx = mcpContext.serverContexts.get(serverUrl)
        const toolResult = await mcpGateway.callTool(
          serverUrl,
          serverCtx?.sessionId ?? null,
          toolCall.name,
          parsedArgs,
        )
        const toolResultPart = createToolResultPart(
          session,
          formatPartId(session.id, turnNumber, currentRound.roundIndex + 1, partNumber++, 'tool-result', input.ownerStepId ?? null),
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
        assistantContentTokens: usage.assistantContentTokens,
        assistantContentParts,
        toolCallParts,
        toolResultParts,
      }

      currentRound = {
        id: formatRoundId(session.id, turnNumber, currentRound.roundIndex + 2, input.ownerStepId ?? null),
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
    let partNumber = getNextRoundPartSequence(database.connection, currentRound.id)

    for (const segment of streamedCompletion.segments) {
      if (segment.kind === 'reasoning') {
        const part = reasoningPartsQueue.shift()
        if (!part) {
          continue
        }
        part.id = formatPartId(session.id, turnNumber, currentRound.roundIndex + 1, partNumber++, 'assistant-reasoning', input.ownerStepId ?? null)
        part.ordinal = ordinal++
        assistantParts.push(part)
        continue
      }

      if (segment.kind === 'content') {
        const part = assistantContentPartsQueue.shift()
        if (!part) {
          continue
        }
        part.id = formatPartId(session.id, turnNumber, currentRound.roundIndex + 1, partNumber++, 'assistant-content', input.ownerStepId ?? null)
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
    maybeApplyAutomaticSessionTitle(session, turn.turnNumber, input.userContent)

    const finalizeTx = database.connection.transaction(() => {
      updateRoundRecord(database.connection, currentRound)
      rawExchanges.forEach(exchange => insertRawExchangeRecord(database.connection, exchange))
      assistantParts.forEach(part => insertPartRecord(database.connection, part))
      updateTurnRecord(database.connection, turn)
      updateSessionRecord(database.connection, session)
    })
    finalizeTx()

    // Apply context compaction (e.g. strip reasoning) now that the turn is fully persisted.
    const compaction = applyContextCompaction(database.connection, turn, session.compactionStrategy)
    Object.assign(turn, compaction.turn)

    assistantParts.forEach(part => emitEvent?.({
      type: 'part-committed',
      part,
    }))
    compaction.parts.forEach(part => emitEvent?.({
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
      round: currentRound,
      rounds,
      parts: persistedParts.filter(part => part.turnId === turnId || part.turnId === compaction.step.id),
      transcript: trace.transcript,
      context: trace.context,
    }
  }

  // The tool-call loop exhausted maxToolRounds without producing a final 'stop' response.
  // `currentRound` was inserted as 'streaming' at the end of the last tool-call iteration
  // but never processed.  Close it out gracefully so the frontend isn't left hanging.
  const errorAt = now()
  currentRound.status = 'error'
  currentRound.finishReason = 'error'
  currentRound.completedAt = errorAt

  turn.status = 'error'
  turn.completedAt = errorAt
  turn.outcome = `tool-loop-limit:${input.maxToolRounds}`

  const diagnosticNote: PartRecord = {
    id: formatPartId(
      session.id,
      turnNumber,
      currentRound.roundIndex + 1,
      getNextRoundPartSequence(database.connection, currentRound.id),
      'diagnostic-note',
    ),
    sessionId: session.id,
    turnId,
    roundId: currentRound.id,
    parentPartId: null,
    ordinal: getNextPartOrdinal(database.connection, session.id),
    partType: 'diagnostic-note',
    roleLabel: 'system',
    payload: {
      text: `Turn stopped: reached the maximum of ${input.maxToolRounds} tool-call rounds without a final assistant response. `
        + `Increase BACKEND_MAX_TOOL_ROUNDS (currently ${input.maxToolRounds}) if this is too low for your workflow.`,
      json: null,
      mimeType: 'text/plain',
      summary: `Tool-loop limit reached (${input.maxToolRounds} rounds)`,
    },
    display: {
      state: 'transcript',
      collapsedByDefault: false,
    },
    context: {
      state: 'excluded',
      note: 'Error diagnostic — not included in model context',
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count: null,
      source: 'unknown',
      confidence: 'unknown',
      note: null,
    },
    provenanceJson: { maxToolRounds: input.maxToolRounds },
    createdAt: errorAt,
    updatedAt: errorAt,
  }

  const errorTx = database.connection.transaction(() => {
    updateRoundRecord(database.connection, currentRound)
    insertPartRecord(database.connection, diagnosticNote)
    updateTurnRecord(database.connection, turn)
    updateSessionRecord(database.connection, session)
  })
  errorTx()

  emitEvent?.({
    type: 'part-committed',
    part: { ...diagnosticNote },
  })
  emitEvent?.({
    type: 'round-committed',
    round: { ...currentRound },
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
  emitEvent?.({
    type: 'turn-committed',
    turn: { ...turn },
    trace: traceOnError,
  })

  return {
    session,
    turn,
    round: currentRound,
    rounds,
    parts: persistedPartsOnError.filter(part => part.turnId === turnId),
    transcript: traceOnError.transcript,
    context: traceOnError.context,
  }
}
