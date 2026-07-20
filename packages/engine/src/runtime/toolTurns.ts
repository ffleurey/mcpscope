import type { BackendDatabase } from '../persistence/db.js'
import { runInTransaction } from '../persistence/connection.js'
import type {
  PartRecord,
  RawExchangeRecord,
  RoundRecord,
  SessionRecord,
  TurnRecord,
} from '../domain/model.js'
import {
  buildApiMessages,
  buildLmToolDefinitions,
  deriveContextEntries,
  deriveTranscriptEntries,
} from '../domain/selectors.js'
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
import {
  formatPartId,
  formatRoundId,
  formatSetupPartId,
  formatTurnId,
} from '../domain/hierarchicalIds.js'
import {
  buildReasoningParams,
  estimateTokensFromText,
  normalizeStreamUsage,
} from '../services/provider/index.js'
import {
  buildDiagnosticNotePart,
  buildStreamFailureRecovery,
  commitSegmentsToParts,
  describeStreamFailure,
  deriveAssistantContentTokenMetadata,
  extractContentSegmentTexts,
  recoverAnswerFromReasoning,
} from './turnAssembly.js'
import {
  sessionContextBody,
  sessionTemperatureBody,
  type ChatCompletionGateway,
  type RuntimeTurnResult,
} from './modelTurns.js'
import type { ApiMessage } from '../domain/selectors.js'
import type {
  AssistantSegment,
  OaiChatCompletionResponse,
  OaiStreamedChatCompletionResult,
} from '../services/openai/client.js'
import type {
  McpAuth,
  McpRawExchange,
  McpToolCallResult,
  McpToolsListResult,
} from '../services/mcp/httpClient.js'
import { buildSessionTraceBundle } from '../domain/trace.js'
import {
  allocateProportionalTokenCounts,
  deriveExactDeltaTokenMetadata,
} from '../domain/tokenAccounting.js'
import {
  deriveExactToolPreludeTokens,
  ensureSessionPreludeTokenMetadata,
} from './sessionPrelude.js'
import { probeRequestPromptTokens } from './promptTokenProbing.js'
import { applyContextCompaction } from '../domain/compaction.js'
import { executeChatCompletion, isDegenerateEmptyCompletion } from './streamedCompletion.js'
import type { TurnStreamEventSink } from './streamEvents.js'
import { maybeApplyAutomaticSessionTitle } from './sessionTitles.js'

export interface McpGateway {
  initializeSession(
    serverUrl: string,
    auth?: McpAuth | null,
  ): Promise<{
    sessionId: string | null
    instructions?: string | undefined
    rawExchange: McpRawExchange
  }>
  listTools(
    serverUrl: string,
    sessionId: string | null,
    auth?: McpAuth | null,
  ): Promise<McpToolsListResult>
  callTool(
    serverUrl: string,
    sessionId: string | null,
    name: string,
    args: Record<string, unknown>,
    auth?: McpAuth | null,
  ): Promise<McpToolCallResult>
}

/** Extract the auth config from an MCP profile snapshot. */
function authForProfile(profile: { authType: McpAuth['type']; authValue: string | null }): McpAuth {
  return { type: profile.authType, value: profile.authValue }
}

export interface McpServerContext {
  sessionId: string | null
  instructions: string | null
  auth: McpAuth | null
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

function parseToolCalls(
  round: RoundRecord,
  response: Awaited<ReturnType<ChatCompletionGateway['createChatCompletion']>>,
): ToolCallRecord[] {
  const toolCalls = response.choices[0]?.message?.tool_calls ?? []
  return toolCalls.map((toolCall, index) => ({
    id: toolCall.id ?? `${round.id}-tool-${index}`,
    name: toolCall.function?.name ?? 'unknown',
    argumentsJson: toolCall.function?.arguments ?? '{}',
  }))
}

/** Recursively sort object keys so two calls that differ only in key order (or
 *  insignificant JSON whitespace) produce the same canonical signature. */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, val]) => [key, sortJsonValue(val)]),
    )
  }
  return value
}

/** Stable signature for a tool call — name + canonicalized arguments — so a
 *  byte-for-byte or key-reordered repeat of the same call within a turn maps to
 *  one key. Non-JSON arguments fall back to the raw string. */
function toolCallSignature(name: string, argumentsJson: string): string {
  let canonicalArgs = argumentsJson
  try {
    canonicalArgs = JSON.stringify(sortJsonValue(JSON.parse(argumentsJson || '{}')))
  } catch {
    /* malformed model output — keep the raw string */
  }
  return `${name}\u0000${canonicalArgs}`
}

/**
 * Loop guard: a model that re-issues an identical tool call within one turn is
 * almost always stuck (small models re-inspect the same id dozens of times,
 * burning the whole round budget without answering). Rather than re-execute —
 * wasting the call and a round — hand back the earlier result plus an explicit
 * nudge to stop repeating and answer, with the remaining round budget spelled
 * out. isError stays false: a skipped duplicate is not a new tool failure and
 * must not inflate error metrics.
 */
function buildDuplicateToolCallResult(
  toolName: string,
  argumentsJson: string,
  priorContent: string,
  roundsLeft: number,
): McpToolCallResult {
  const budgetLine =
    roundsLeft > 0
      ? `You have ${roundsLeft} tool-call round${roundsLeft === 1 ? '' : 's'} left before you must give your final answer.`
      : 'This is your last tool-call round; you must give your final answer next.'
  const notice =
    `Duplicate tool call skipped: you already called ${toolName} with identical arguments earlier in this turn, so it was not run again. ${budgetLine} ` +
    'Do not repeat this call — use the result you already have, or give your final answer now. The earlier result is reproduced below:\n\n' +
    priorContent
  return {
    content: notice,
    structuredContent: null,
    isError: false,
    rawResult: null,
    rawExchange: {
      requestUrl: 'about:duplicate-tool-call',
      requestMethod: 'POST',
      requestBodyText: argumentsJson,
      responseStatus: 0,
      responseBody: null,
      responseBodyText: notice,
    },
  }
}

function createProviderRawExchange(
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
      kind: 'llm-request',
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
      kind: 'llm-response',
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
  const toolJson = part.payload.json as {
    id?: string
    name?: string
    arguments?: string
  } | null
  return JSON.stringify({
    id: toolJson?.id ?? part.id,
    name: toolJson?.name ?? 'unknown',
    arguments: toolJson?.arguments ?? '{}',
  }).length
}

function serializeAssistantContentWeight(part: PartRecord): number {
  return (part.payload.text ?? '').length
}

function estimateDeterministicToolCallTokens(toolCall: ToolCallRecord): PartRecord['tokens'] {
  return {
    count: estimateTokensFromText(
      JSON.stringify({
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.argumentsJson,
      }),
    ),
    source: 'estimated',
    confidence: 'estimated',
    note: 'Estimated from deterministic tool-call payload size',
  }
}

function estimateDeterministicToolResultTokens(
  toolResult: McpToolCallResult,
): PartRecord['tokens'] {
  const serialized =
    toolResult.content ??
    (toolResult.structuredContent == null ? '' : JSON.stringify(toolResult.structuredContent))
  return {
    count: estimateTokensFromText(serialized),
    source: 'estimated',
    confidence: 'estimated',
    note: 'Estimated from deterministic tool-result payload size',
  }
}

function updatePartTokens(
  part: PartRecord,
  tokens: PartRecord['tokens'],
  provenanceAdditions: unknown,
  updatedAt: number,
): PartRecord {
  // Merge, never replace: tool-result parts carry { toolCallId, toolName,
  // isError } from creation, and benchmark metrics / analysis evidence read
  // those fields — token attribution must only add its derivedFrom keys.
  return {
    ...part,
    tokens,
    provenanceJson: {
      ...((part.provenanceJson as Record<string, unknown> | null) ?? {}),
      ...((provenanceAdditions as Record<string, unknown> | null) ?? {}),
    },
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
    const prefixTokens =
      prefixMessages.length > 0
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
      { derivedFrom: 'prompt_tokens.user-delta' },
      updatedAt,
    )

    const tx = () =>
      runInTransaction(database.connection, () => {
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
  const prefixTokens = await probeRequestPromptTokens(
    chatCompletionGateway,
    session,
    prefixMessages,
    lmTools,
    traceContext,
  )
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

  const groupedAssistantParts = [...pending.assistantContentParts, ...pending.toolCallParts]
  const groupedAllocations =
    pending.assistantContentParts.length === 0 && pending.toolCallParts.length === 1
      ? [toolCallGroupTokens]
      : allocateProportionalTokenCounts(
          toolCallGroupTokens,
          groupedAssistantParts.map((part) =>
            part.partType === 'assistant-content'
              ? serializeAssistantContentWeight(part)
              : serializeToolCallWeight(part),
          ),
        )

  // Confidence for the tool-call message attribution:
  // - Exact when: no tool results (delta is exact) + single tool call + no text content.
  // - exact-api when: tool results present + single tool call + no text (uses completion_tokens directly).
  // - Estimated otherwise: multiple parts or multiple tool calls (proportional allocation).
  const singleExactCase =
    !hasToolResults &&
    pending.assistantContentParts.length === 0 &&
    pending.toolCallParts.length === 1
  const singleApiCase =
    hasToolResults &&
    pending.assistantContentParts.length === 0 &&
    pending.toolCallParts.length === 1
  const updatedAssistantContentParts = pending.assistantContentParts.map((part, index) =>
    updatePartTokens(
      part,
      {
        count: groupedAllocations[index] ?? 0,
        source: 'estimated',
        confidence: 'estimated',
        note: hasToolResults
          ? 'Allocated proportionally from completion_tokens (tool results present; prompt probe returns 0 for tool_calls)'
          : 'Allocated proportionally from the exact grouped assistant message prompt delta',
      },
      {
        derivedFrom: hasToolResults
          ? 'completion.usage.assistant-content-tokens'
          : 'prompt_tokens.assistant-tool-message-delta',
        allocation: 'proportional-by-payload',
      },
      updatedAt,
    ),
  )
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
        ? { derivedFrom: 'prompt_tokens.tool-call-delta' }
        : singleApiCase
          ? { derivedFrom: 'completion.usage.assistant-content-tokens' }
          : {
              derivedFrom: hasToolResults
                ? 'completion.usage.assistant-content-tokens'
                : 'prompt_tokens.assistant-tool-message-delta',
              allocation: 'proportional-by-payload',
            },
      updatedAt,
    )
  })

  // Tool result attribution: allocate the remaining budget proportionally.
  // Total = promptTokens − prefixTokens − toolCallGroupTokens (conserved exactly).
  // Individual splits are proportional by content length → confidence: estimated.
  // This avoids per-result probes, which also suffered from the assistant-message blind spot.
  const totalToolResultTokens =
    promptTokens == null ? null : Math.max(0, promptTokens - prefixTokens - toolCallGroupTokens)
  const toolResultWeights = pending.toolResultParts.map((p) =>
    Math.max(1, (p.payload.text ?? '').length),
  )
  const toolResultAllocations =
    totalToolResultTokens == null || pending.toolResultParts.length === 0
      ? pending.toolResultParts.map(() => null)
      : pending.toolResultParts.length === 1
        ? [totalToolResultTokens]
        : allocateProportionalTokenCounts(totalToolResultTokens, toolResultWeights)

  const updatedToolResultParts: PartRecord[] = pending.toolResultParts.map((part, index) => {
    const count = toolResultAllocations[index]
    return updatePartTokens(
      part,
      count == null
        ? {
            count: null,
            source: 'unknown',
            confidence: 'unknown',
            note: 'Prompt token total was not available',
          }
        : {
            count,
            source: 'estimated',
            confidence: 'estimated',
            note:
              pending.toolResultParts.length === 1
                ? 'Derived as total tool-result context budget (promptTokens − prefix − assistantMessage)'
                : 'Allocated proportionally from total tool-result context budget (promptTokens − prefix − assistantMessage)',
          },
      { derivedFrom: 'prompt_tokens.tool-result-proportional' },
      updatedAt,
    )
  })

  const tx = () =>
    runInTransaction(database.connection, () => {
      updatedAssistantContentParts.forEach((part) => updatePartRecord(database.connection, part))
      updatedToolCallParts.forEach((part) => updatePartRecord(database.connection, part))
      updatedToolResultParts.forEach((part) => updatePartRecord(database.connection, part))
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
  const hasInstructions = existingParts.some(
    (part) => part.turnId === null && part.partType === 'mcp-instructions',
  )
  const hasToolDefinitions = existingParts.some(
    (part) => part.turnId === null && part.partType === 'tool-definitions',
  )

  const serverContexts = new Map<string, McpServerContext>()
  const combinedTools: McpToolsListResult['tools'] = []
  const toolServerMap = new Map<string, string>()
  const instructionsBuilder: string[] = []
  type PendingRawExchange = {
    kind: 'init' | 'tools'
    exchange: McpRawExchange
  }

  const pendingRawExchanges: Array<{
    init: PendingRawExchange
    tools: PendingRawExchange
  }> = []

  for (const profile of session.mcpProfileSnapshots) {
    const auth = authForProfile(profile)
    const initialized = await mcpGateway.initializeSession(profile.url, auth)
    const toolsList = await mcpGateway.listTools(profile.url, initialized.sessionId, auth)

    serverContexts.set(profile.url, {
      sessionId: initialized.sessionId,
      instructions: initialized.instructions ?? null,
      auth,
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
        const warnFn = logger?.warn ?? (() => {})
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

  runInTransaction(database.connection, () => {
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
        id: formatSetupPartId(session.id, preludePartNumber, 'mcp-instructions'),
        sessionId: session.id,
        turnId: null,
        roundId: null,
        parentPartId: null,
        ordinal: ordinal,
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
          summary: combinedTools.map((tool) => tool.name).join(', '),
        },
        display: {
          state: 'diagnostic',
          collapsedByDefault: true,
        },
        context: {
          state: 'included',
          note: "Provided through the provider's tools parameter",
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
  })

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
  const serverAuthMap = new Map<string, McpAuth>()
  for (const profile of session.mcpProfileSnapshots) {
    const auth = authForProfile(profile)
    serverAuthMap.set(profile.url, auth)
    for (const tool of (await mcpGateway.listTools(profile.url, null, auth)).tools) {
      if (!deterministicToolServerMap.has(tool.name)) {
        deterministicToolServerMap.set(tool.name, profile.url)
      }
    }
  }
  const serverUrl = deterministicToolServerMap.get(toolName)
  if (!serverUrl) {
    throw new Error(`No MCP server found for tool "${toolName}"`)
  }
  const serverAuth = serverAuthMap.get(serverUrl) ?? null
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
    ? formatPartId(
        session.id,
        turnNumber,
        roundNumber,
        nextRoundPartSequence,
        'user-message',
        ownerStepId ?? null,
      )
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
        ...(listTurnRecordsBySession(database.connection, session.id).find(
          (t) => t.id === turnId,
        ) ?? {
          id: turnId,
          sessionId: session.id,
          ownerStepId: ownerStepId ?? null,
          turnNumber,
          status: 'streaming',
          outcome: null,
          usage: {
            promptTokens: null,
            completionTokens: null,
            reasoningTokens: null,
            totalTokens: null,
          },
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
        usage: {
          promptTokens: null,
          completionTokens: null,
          reasoningTokens: null,
          totalTokens: null,
        },
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
    usage: {
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
    requestPayloadJson: null,
    responseTraceJson: null,
    startedAt: ts,
    completedAt: null,
  }
  const userPart =
    userPartId && userContextMessage
      ? createUserPart(
          session,
          userPartId,
          turnId,
          roundId,
          userPartOrdinal,
          userContextMessage,
          ts,
        )
      : null
  const toolCallOrdinal = userPart ? userPartOrdinal + 1 : userPartOrdinal
  const toolResultOrdinal = toolCallOrdinal + 1
  const toolCallPart = createToolCallPart(
    session,
    toolCallPartId,
    turnId,
    roundId,
    toolCallOrdinal,
    toolCall,
    ts,
  )
  toolCallPart.tokens = estimateDeterministicToolCallTokens(toolCall)
  toolCallPart.provenanceJson = {
    ...((toolCallPart.provenanceJson as Record<string, unknown> | null) ?? {}),
    derivedFrom: 'deterministic-tool-call-payload-estimate',
  }

  runInTransaction(database.connection, () => {
    if (!reservedTurnId) {
      insertTurnRecord(database.connection, turn)
    } else {
      updateTurnRecord(database.connection, turn)
    }
    insertRoundRecord(database.connection, round)
    if (userPart) insertPartRecord(database.connection, userPart)
    insertPartRecord(database.connection, toolCallPart)
  })

  if (!reservedTurnId) {
    emitEvent?.({ type: 'turn-started', turn: { ...turn } })
  }
  emitEvent?.({ type: 'round-started', round: { ...round } })
  if (userPart) emitEvent?.({ type: 'part-committed', part: { ...userPart } })
  emitEvent?.({ type: 'part-committed', part: { ...toolCallPart } })

  // Perform the actual MCP tool call
  const mcpSession = await mcpGateway.initializeSession(serverUrl, serverAuth)
  const toolResult = await mcpGateway.callTool(
    serverUrl,
    mcpSession.sessionId,
    toolName,
    toolArgs,
    serverAuth,
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
    ...((toolResultPart.provenanceJson as Record<string, unknown> | null) ?? {}),
    derivedFrom: 'deterministic-tool-result-payload-estimate',
  }

  turn.status = 'complete'
  turn.outcome = 'deterministic-tool-call'
  turn.completedAt = completedAt

  round.status = 'complete'
  round.completedAt = completedAt

  runInTransaction(database.connection, () => {
    updateTurnRecord(database.connection, turn)
    updateRoundRecord(database.connection, round)
    insertPartRecord(database.connection, toolResultPart)
    insertRawExchangeRecord(
      database.connection,
      makeRawExchangeRecord(session.id, turnId, roundId, 'mcp-request', mcpSession.rawExchange, ts),
    )
    insertRawExchangeRecord(
      database.connection,
      makeRawExchangeRecord(
        session.id,
        turnId,
        roundId,
        'mcp-response',
        mcpSession.rawExchange,
        ts,
      ),
    )
    insertRawExchangeRecord(
      database.connection,
      makeRawExchangeRecord(
        session.id,
        turnId,
        roundId,
        'mcp-request',
        toolResult.rawExchange,
        completedAt,
      ),
    )
    insertRawExchangeRecord(
      database.connection,
      makeRawExchangeRecord(
        session.id,
        turnId,
        roundId,
        'mcp-response',
        toolResult.rawExchange,
        completedAt,
      ),
    )
  })

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
): Promise<{
  turnId: string
  toolCallPartIds: string[]
  toolResultPartIds: string[]
}> {
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

interface ToolTurnFailureInfo {
  message: string
  receivedBytes: number | null
  segments: AssistantSegment[]
  completion: OaiChatCompletionResponse | null
}

/**
 * Closes out a tool-enabled turn whose current round couldn't reach a clean
 * completion — a mid-stream read failure — without discarding whatever the
 * model already streamed or any prior rounds already committed this turn.
 * Same shape as the existing tool-loop-limit graceful-close below: persist
 * everything recoverable, mark the round/turn 'error', and return a normal
 * RuntimeTurnResult instead of throwing.
 */
function finalizeToolTurnStreamFailure(
  database: BackendDatabase,
  session: SessionRecord,
  turn: TurnRecord,
  currentRound: RoundRecord,
  rounds: RoundRecord[],
  turnId: string,
  turnNumber: number,
  ownerStepId: string | null,
  info: ToolTurnFailureInfo,
  emitEvent: TurnStreamEventSink | undefined,
  // A provider response that arrived intact but empty (see the empty-completion
  // path) is worth keeping so the operator can inspect exactly what came back;
  // a mid-stream read failure has nothing to persist and passes none.
  rawExchanges: RawExchangeRecord[] = [],
): RuntimeTurnResult {
  const completedAt = now()

  const recovery = buildStreamFailureRecovery({
    session,
    turnId,
    turnNumber,
    roundNumber: currentRound.roundIndex + 1,
    roundId: currentRound.id,
    ownerStepId,
    segments: info.segments,
    message: info.message,
    receivedBytes: info.receivedBytes,
    initialOrdinal: getNextPartOrdinal(database.connection, session.id),
    initialPartNumber: getNextRoundPartSequence(database.connection, currentRound.id),
    createdAt: completedAt,
  })

  currentRound.status = 'error'
  currentRound.finishReason = 'error'
  currentRound.completedAt = completedAt
  currentRound.responseTraceJson = {
    completion: info.completion,
    assistantSegments: info.segments,
    error: info.message,
  }

  turn.status = 'error'
  turn.completedAt = completedAt
  turn.outcome = `step-error: ${info.message}`

  const errorTx = () =>
    runInTransaction(database.connection, () => {
      updateRoundRecord(database.connection, currentRound)
      for (const exchange of rawExchanges) {
        insertRawExchangeRecord(database.connection, exchange)
      }
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
    errorType: 'internal',
    message: info.message,
  })

  return {
    session,
    turn,
    round: currentRound,
    rounds,
    parts: persistedPartsOnError.filter((part) => part.turnId === turnId),
    transcript: traceOnError.transcript,
    context: traceOnError.context,
  }
}

export async function createToolEnabledTurn(
  database: BackendDatabase,
  chatCompletionGateway: ChatCompletionGateway,
  mcpGateway: McpGateway,
  input: {
    sessionId: string
    userContent: string
    maxToolRounds: number
    ownerStepId?: string | null | undefined
    reservedTurn?: TurnRecord | undefined
  },
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
  const turnNumber =
    input.reservedTurn?.turnNumber ??
    getNextTurnNumber(database.connection, session.id, input.ownerStepId ?? null)
  const turnId =
    input.reservedTurn?.id ?? formatTurnId(session.id, turnNumber, input.ownerStepId ?? null)
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
    formatPartId(
      session.id,
      turnNumber,
      1,
      getNextRoundPartSequence(database.connection, userRoundId),
      'user-message',
      input.ownerStepId ?? null,
    ),
    turnId,
    userRoundId,
    getNextPartOrdinal(database.connection, session.id),
    input.userContent,
    startedAt,
  )
  const initializeTx = () =>
    runInTransaction(database.connection, () => {
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
  // Per-turn record of executed tool calls (signature → result content), used to
  // detect and short-circuit repeated identical calls within this turn.
  const executedToolCalls = new Map<string, string>()

  for (let roundIndex = 0; roundIndex < input.maxToolRounds; roundIndex++) {
    const requestBody: Record<string, unknown> = {
      model: session.modelProfileSnapshot.modelKey,
      stream: true,
      stream_options: {
        include_usage: true,
      },
      messages: requestMessages,
      tools: lmTools,
      ...sessionTemperatureBody(session),
      ...buildReasoningParams(
        session.modelProfileSnapshot.reasoning,
        session.modelProfileSnapshot.connectionBaseUrl,
        session.modelProfileSnapshot.providerType,
      ),
      ...sessionContextBody(session),
    }

    currentRound.requestPayloadJson = requestBody
    updateRoundRecord(database.connection, currentRound)

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
              roundId: currentRound.id,
              delta,
            })
          },
        },
      )
    } catch (err) {
      return finalizeToolTurnStreamFailure(
        database,
        session,
        turn,
        currentRound,
        rounds,
        turnId,
        turnNumber,
        input.ownerStepId ?? null,
        describeStreamFailure(err),
        emitEvent,
      )
    }
    const completion = streamedCompletion.completion

    const completedAt = now()
    const finishReason = completion.choices[0]?.finish_reason
    const provider = session.modelProfileSnapshot.providerType ?? 'lmstudio'
    const usage = normalizeStreamUsage(streamedCompletion.rawResponseBody, provider)

    // A response that arrived intact but empty — no content, no tool call, and
    // no reasoning text (finish_reason not "length") — is a provider/connection
    // failure, not a real answer. It commonly happens with OpenRouter-fronted
    // models (e.g. Gemini 2.5 Flash Lite burning its whole budget on hidden
    // reasoning). Mark the turn errored so it lands in the manually-retryable
    // error state rather than being silently recorded as a completed, answerless
    // turn. The raw exchange is preserved so the empty response stays inspectable.
    if (isDegenerateEmptyCompletion(streamedCompletion)) {
      currentRound.usage = {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        reasoningTokens: usage.reasoningTokens,
        totalTokens: usage.totalTokens,
      }
      return finalizeToolTurnStreamFailure(
        database,
        session,
        turn,
        currentRound,
        rounds,
        turnId,
        turnNumber,
        input.ownerStepId ?? null,
        {
          message:
            'Model returned an empty response (no content, tool call, or reasoning). This is usually a transient provider or connection error — retry the session.',
          receivedBytes: null,
          segments: [],
          completion,
        },
        emitEvent,
        createProviderRawExchange(
          session,
          turnId,
          currentRound.id,
          requestBody,
          streamedCompletion.rawResponseBody,
          currentRound.startedAt,
          completedAt,
        ),
      )
    }

    currentRound.status = 'complete'
    const roundTruncated = finishReason === 'length'
    currentRound.finishReason =
      finishReason === 'tool_calls' ? 'tool_calls' : roundTruncated ? 'length' : 'stop'
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

    const rawExchanges = createProviderRawExchange(
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
      const assistantContentSegments = extractContentSegmentTexts(streamedCompletion.segments)
      const toolCallPartsByIndex = new Map<number, PartRecord>()
      const toolResultParts: PartRecord[] = []

      const {
        parts: assistantMessageParts,
        nextOrdinal,
        nextPartNumber,
      } = commitSegmentsToParts({
        session,
        turnId,
        turnNumber,
        roundNumber: currentRound.roundIndex + 1,
        roundId: currentRound.id,
        ownerStepId: input.ownerStepId ?? null,
        segments: streamedCompletion.segments,
        reasoningTokens: usage.reasoningTokens,
        // Assistant content that shares a tool-call message has its token share
        // resolved later by applyPendingPromptSuffixAttribution, so seed unknowns.
        contentTokenMetadata: assistantContentSegments.map(() => ({
          count: null,
          source: 'unknown' as const,
          confidence: 'unknown' as const,
          note: 'Assistant content shared a tool-call message; prompt delta allocation is pending',
          provenanceJson: null,
        })),
        contentContextNote:
          'Assistant content shared a tool-call message and remains part of later model-visible history',
        initialOrdinal: getNextPartOrdinal(database.connection, session.id),
        initialPartNumber: getNextRoundPartSequence(database.connection, currentRound.id),
        createdAt: completedAt,
        onToolCallSegment: (segment, partNumber, ordinal) => {
          const toolCall = toolCallByIndex.get(segment.toolCallIndex)
          if (!toolCall || toolCallPartsByIndex.has(segment.toolCallIndex)) {
            return null
          }
          const toolCallPart = createToolCallPart(
            session,
            formatPartId(
              session.id,
              turnNumber,
              currentRound.roundIndex + 1,
              partNumber,
              'tool-call',
              input.ownerStepId ?? null,
            ),
            turnId,
            currentRound.id,
            ordinal,
            toolCall,
            completedAt,
          )
          toolCallPartsByIndex.set(segment.toolCallIndex, toolCallPart)
          return toolCallPart
        },
      })

      const assistantContentParts = assistantMessageParts.filter(
        (part) => part.partType === 'assistant-content',
      )
      const toolCallParts = [...toolCallPartsByIndex.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, part]) => part)

      let toolResultOrdinal = nextOrdinal
      let toolResultPartNumber = nextPartNumber
      for (const toolCallPart of toolCallParts) {
        const toolJson = toolCallPart.payload.json as {
          id?: string
          name?: string
          arguments?: string
        } | null
        const toolCall = {
          id: toolJson?.id ?? toolCallPart.id,
          name: toolJson?.name ?? 'unknown',
          argumentsJson: toolJson?.arguments ?? '{}',
        }
        // Model output is untrusted: malformed argument JSON or a hallucinated
        // tool name must come back to the model as an error tool-result it can
        // correct on the next round — not crash the turn (small local models
        // produce both routinely, and inspecting that failure is the point).
        let parsedArgs: Record<string, unknown> | null = null
        let invalidCallError: string | null = null
        try {
          parsedArgs = JSON.parse(toolCall.argumentsJson || '{}') as Record<string, unknown>
        } catch {
          invalidCallError = `Tool call rejected: arguments are not valid JSON: ${toolCall.argumentsJson.slice(0, 500)}`
        }
        const serverUrl = mcpContext.toolServerMap.get(toolCall.name)
        if (!invalidCallError && !serverUrl) {
          invalidCallError = `Tool call rejected: no tool named "${toolCall.name}" is available in this session.`
        }
        const signature = toolCallSignature(toolCall.name, toolCall.argumentsJson)
        const priorContent = executedToolCalls.get(signature)
        // Rounds the model still gets after this one before the loop forces a stop.
        const roundsLeft = input.maxToolRounds - 1 - currentRound.roundIndex
        let toolResult: McpToolCallResult
        if (priorContent !== undefined) {
          // Repeated identical call this turn — short-circuit instead of re-running.
          toolResult = buildDuplicateToolCallResult(
            toolCall.name,
            toolCall.argumentsJson,
            priorContent,
            roundsLeft,
          )
        } else if (invalidCallError || !serverUrl) {
          toolResult = {
            content: invalidCallError ?? 'Tool call rejected.',
            structuredContent: { error: { message: invalidCallError } },
            isError: true,
            rawResult: null,
            rawExchange: {
              requestUrl: serverUrl ?? 'about:invalid',
              requestMethod: 'POST',
              requestBodyText: toolCall.argumentsJson,
              responseStatus: 0,
              responseBody: null,
              responseBodyText: invalidCallError,
            },
          }
          executedToolCalls.set(signature, toolResult.content)
        } else {
          const serverCtx = mcpContext.serverContexts.get(serverUrl)
          toolResult = await mcpGateway.callTool(
            serverUrl,
            serverCtx?.sessionId ?? null,
            toolCall.name,
            parsedArgs ?? {},
            serverCtx?.auth ?? null,
          )
          executedToolCalls.set(signature, toolResult.content)
        }
        const toolResultPart = createToolResultPart(
          session,
          formatPartId(
            session.id,
            turnNumber,
            currentRound.roundIndex + 1,
            toolResultPartNumber++,
            'tool-result',
            input.ownerStepId ?? null,
          ),
          turnId,
          currentRound.id,
          toolResultOrdinal++,
          toolCallPart.id,
          toolCall,
          toolResult,
          now(),
        )
        toolResultParts.push(toolResultPart)

        insertRawExchangeRecord(
          database.connection,
          makeRawExchangeRecord(
            session.id,
            turnId,
            currentRound.id,
            'mcp-request',
            toolResult.rawExchange,
            now(),
          ),
        )
        insertRawExchangeRecord(
          database.connection,
          makeRawExchangeRecord(
            session.id,
            turnId,
            currentRound.id,
            'mcp-response',
            toolResult.rawExchange,
            now(),
          ),
        )
      }

      const toolTx = () =>
        runInTransaction(database.connection, () => {
          updateRoundRecord(database.connection, currentRound)
          rawExchanges.forEach((exchange) => insertRawExchangeRecord(database.connection, exchange))
          assistantMessageParts.forEach((part) => insertPartRecord(database.connection, part))
          toolResultParts.forEach((part) => insertPartRecord(database.connection, part))
        })
      toolTx()
      assistantMessageParts.forEach((part) =>
        emitEvent?.({
          type: 'part-committed',
          part,
        }),
      )
      toolResultParts.forEach((part) =>
        emitEvent?.({
          type: 'part-committed',
          part,
        }),
      )
      emitEvent?.({
        type: 'round-committed',
        round: { ...currentRound },
      })

      const baseMessageCount = requestMessages.length
      requestMessages = [
        ...requestMessages,
        {
          role: 'assistant',
          content: assistantContentParts.map((part) => part.payload.text ?? '').join('') || null,
          tool_calls: toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.argumentsJson,
            },
          })),
        },
        ...toolResultParts.map((part) => ({
          role: 'tool' as const,
          content: part.payload.text,
          tool_call_id:
            (part.provenanceJson as { toolCallId?: string } | null)?.toolCallId ??
            part.parentPartId ??
            part.id,
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
        id: formatRoundId(
          session.id,
          turnNumber,
          currentRound.roundIndex + 2,
          input.ownerStepId ?? null,
        ),
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

    // Recover an answer emitted in the reasoning channel with empty content
    // (interleaved-thinking models) — but not on a truncated round, where
    // reasoning is partial thinking rather than the final answer.
    const { segments: answerSegments, recovered: answerFromReasoning } = roundTruncated
      ? { segments: streamedCompletion.segments, recovered: false }
      : recoverAnswerFromReasoning(streamedCompletion.segments)
    const assistantContentSegments = extractContentSegmentTexts(answerSegments)

    const {
      parts: streamedParts,
      nextOrdinal,
      nextPartNumber,
    } = commitSegmentsToParts({
      session,
      turnId,
      turnNumber,
      roundNumber: currentRound.roundIndex + 1,
      roundId: currentRound.id,
      ownerStepId: input.ownerStepId ?? null,
      segments: answerSegments,
      reasoningTokens: usage.reasoningTokens,
      contentTokenMetadata: deriveAssistantContentTokenMetadata(
        assistantContentSegments,
        usage.assistantContentTokens,
      ),
      contentContextNote: 'Assistant answer remains part of later model-visible history',
      initialOrdinal: getNextPartOrdinal(database.connection, session.id),
      initialPartNumber: getNextRoundPartSequence(database.connection, currentRound.id),
      createdAt: completedAt,
    })

    // Truncation isn't an error — the response is complete-but-capped — but
    // it's still an anomaly worth surfacing in the transcript rather than
    // leaving buried in round.finishReason. A reasoning-channel recovery gets
    // its own note so the coercion is visible rather than silent.
    const assistantParts = roundTruncated
      ? [
          ...streamedParts,
          buildDiagnosticNotePart({
            session,
            turnId,
            turnNumber,
            roundNumber: currentRound.roundIndex + 1,
            roundId: currentRound.id,
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
              roundNumber: currentRound.roundIndex + 1,
              roundId: currentRound.id,
              ownerStepId: input.ownerStepId ?? null,
              partNumber: nextPartNumber,
              ordinal: nextOrdinal,
              text: 'Final answer recovered from the reasoning channel: the model ended the turn with empty content but non-empty reasoning (common for interleaved-thinking models). The reasoning text is surfaced as the assistant answer so it is retained and scored.',
              summary: 'Answer recovered from reasoning channel',
              createdAt: completedAt,
            }),
          ]
        : streamedParts

    turn.status = 'complete'
    turn.completedAt = completedAt
    turn.outcome =
      (currentRound.roundIndex > 0 ? 'tool-assisted-response' : 'model-response') +
      (roundTruncated ? '-truncated' : '')
    turn.usage = { ...currentRound.usage }

    session.status = 'active'
    session.updatedAt = completedAt
    maybeApplyAutomaticSessionTitle(session, turn.turnNumber, input.userContent)

    const finalizeTx = () =>
      runInTransaction(database.connection, () => {
        updateRoundRecord(database.connection, currentRound)
        rawExchanges.forEach((exchange) => insertRawExchangeRecord(database.connection, exchange))
        assistantParts.forEach((part) => insertPartRecord(database.connection, part))
        updateTurnRecord(database.connection, turn)
        updateSessionRecord(database.connection, session)
      })
    finalizeTx()

    // Apply context compaction (e.g. strip reasoning) now that the turn is fully persisted.
    const compaction = applyContextCompaction(database.connection, turn, session.compactionStrategy)
    Object.assign(turn, compaction.turn)

    assistantParts.forEach((part) =>
      emitEvent?.({
        type: 'part-committed',
        part,
      }),
    )
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
      parts: persistedParts.filter((part) => part.turnId === turnId),
      transcript: trace.transcript,
      context: trace.context,
    }
  }

  // Budget exhausted without a final 'stop' answer. `currentRound` was inserted
  // as 'streaming' at the end of the last tool-call iteration but never processed.
  // Before giving up, give the model ONE final round with tools DISABLED and an
  // explicit instruction to answer now from what it already gathered. A forced,
  // possibly-imperfect answer is far more useful than an empty error — e.g. an
  // LLM judge that spent its whole budget inspecting can still emit its verdict.
  // Only if this also yields no answer do we fall through to the error below.
  const finalDirective =
    `You have used all ${input.maxToolRounds} tool-call rounds and cannot call any more tools. ` +
    'Provide your final answer now, using the information you have already gathered. ' +
    'If the information is incomplete, give your best answer with what you have.'
  const finalMessages: ApiMessage[] = [
    ...requestMessages,
    { role: 'user', content: finalDirective },
  ]
  const finalRequestBody: Record<string, unknown> = {
    model: session.modelProfileSnapshot.modelKey,
    stream: true,
    stream_options: { include_usage: true },
    messages: finalMessages,
    // tools intentionally omitted: this round must produce a text answer.
    ...sessionTemperatureBody(session),
    ...buildReasoningParams(
      session.modelProfileSnapshot.reasoning,
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.providerType,
    ),
    ...sessionContextBody(session),
  }
  currentRound.requestPayloadJson = finalRequestBody
  updateRoundRecord(database.connection, currentRound)

  let finalCompletion: OaiStreamedChatCompletionResult | null = null
  try {
    finalCompletion = await executeChatCompletion(
      chatCompletionGateway,
      session.modelProfileSnapshot.connectionBaseUrl,
      session.modelProfileSnapshot.apiKey ?? undefined,
      finalRequestBody,
      {
        onDelta(delta) {
          emitEvent?.({ type: 'part-delta', turnId, roundId: currentRound.id, delta })
        },
      },
    )
  } catch {
    // Stream failed on the recovery round — finalCompletion stays null and we
    // fall through to the error path below.
  }

  // Recover a reasoning-channel answer here too, so an interleaved-thinking model
  // that answers the forced final round in its reasoning still counts as answered.
  const finalRecovery = finalCompletion
    ? recoverAnswerFromReasoning(finalCompletion.segments)
    : { segments: [], recovered: false }
  const finalContentSegments = extractContentSegmentTexts(finalRecovery.segments)
  if (finalCompletion && finalContentSegments.join('').trim().length > 0) {
    const finalCompletedAt = now()
    const provider = session.modelProfileSnapshot.providerType ?? 'lmstudio'
    const finalUsage = normalizeStreamUsage(finalCompletion.rawResponseBody, provider)

    currentRound.status = 'complete'
    currentRound.finishReason = 'stop'
    currentRound.completedAt = finalCompletedAt
    currentRound.usage = {
      promptTokens: finalUsage.promptTokens,
      completionTokens: finalUsage.completionTokens,
      reasoningTokens: finalUsage.reasoningTokens,
      totalTokens: finalUsage.totalTokens,
    }
    currentRound.responseTraceJson = {
      completion: finalCompletion.completion,
      assistantSegments: finalCompletion.segments,
    }
    rounds.push({ ...currentRound })

    // applyPendingPromptSuffixAttribution always returns null — DB side-effects only
    await applyPendingPromptSuffixAttribution(
      database,
      chatCompletionGateway,
      session,
      requestMessages,
      lmTools,
      finalUsage.promptTokens,
      sessionParts,
      pendingPromptSuffix,
    )

    const {
      parts: streamedParts,
      nextOrdinal,
      nextPartNumber,
    } = commitSegmentsToParts({
      session,
      turnId,
      turnNumber,
      roundNumber: currentRound.roundIndex + 1,
      roundId: currentRound.id,
      ownerStepId: input.ownerStepId ?? null,
      segments: finalRecovery.segments,
      reasoningTokens: finalUsage.reasoningTokens,
      contentTokenMetadata: deriveAssistantContentTokenMetadata(
        finalContentSegments,
        finalUsage.assistantContentTokens,
      ),
      contentContextNote: 'Assistant answer remains part of later model-visible history',
      initialOrdinal: getNextPartOrdinal(database.connection, session.id),
      initialPartNumber: getNextRoundPartSequence(database.connection, currentRound.id),
      createdAt: finalCompletedAt,
    })

    // Record that this answer was forced after the tool-loop limit, so the trace
    // still shows the budget was hit even though the turn now completes cleanly.
    const budgetNote = buildDiagnosticNotePart({
      session,
      turnId,
      turnNumber,
      roundNumber: currentRound.roundIndex + 1,
      roundId: currentRound.id,
      ownerStepId: input.ownerStepId ?? null,
      partNumber: nextPartNumber,
      ordinal: nextOrdinal,
      text:
        `Tool-call budget reached: the model used all ${input.maxToolRounds} tool rounds, then produced this answer in a final tools-disabled round. ` +
        `Raise this session's max tool rounds (currently ${input.maxToolRounds}) — or the BACKEND_MAX_TOOL_ROUNDS default — if the workflow legitimately needs more.`,
      summary: `Final answer forced after tool-loop limit (${input.maxToolRounds} rounds)`,
      createdAt: finalCompletedAt,
    })
    const assistantParts = [...streamedParts, budgetNote]

    const finalRawExchanges = createProviderRawExchange(
      session,
      turnId,
      currentRound.id,
      finalRequestBody,
      finalCompletion.rawResponseBody,
      currentRound.startedAt,
      finalCompletedAt,
    )

    turn.status = 'complete'
    turn.completedAt = finalCompletedAt
    turn.outcome = `tool-assisted-response-after-limit:${input.maxToolRounds}`
    turn.usage = { ...currentRound.usage }
    session.status = 'active'
    session.updatedAt = finalCompletedAt
    maybeApplyAutomaticSessionTitle(session, turn.turnNumber, input.userContent)

    runInTransaction(database.connection, () => {
      updateRoundRecord(database.connection, currentRound)
      finalRawExchanges.forEach((exchange) => insertRawExchangeRecord(database.connection, exchange))
      assistantParts.forEach((part) => insertPartRecord(database.connection, part))
      updateTurnRecord(database.connection, turn)
      updateSessionRecord(database.connection, session)
    })

    const compaction = applyContextCompaction(database.connection, turn, session.compactionStrategy)
    Object.assign(turn, compaction.turn)

    assistantParts.forEach((part) => emitEvent?.({ type: 'part-committed', part }))
    emitEvent?.({ type: 'round-committed', round: { ...currentRound } })

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
    emitEvent?.({ type: 'turn-committed', turn: { ...turn }, trace })
    return {
      session,
      turn,
      round: currentRound,
      rounds,
      parts: persistedParts.filter((part) => part.turnId === turnId),
      transcript: trace.transcript,
      context: trace.context,
    }
  }

  // The final tools-disabled round also produced no answer (or its stream failed).
  // `currentRound` is still 'streaming'; close it out gracefully so the frontend
  // isn't left hanging.
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
      text:
        `Turn stopped: reached the maximum of ${input.maxToolRounds} tool-call rounds, and a final tools-disabled round still produced no assistant answer. ` +
        `Raise this session's max tool rounds (currently ${input.maxToolRounds}) — or the BACKEND_MAX_TOOL_ROUNDS default — if this is too low for your workflow.`,
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

  const errorTx = () =>
    runInTransaction(database.connection, () => {
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
    parts: persistedPartsOnError.filter((part) => part.turnId === turnId),
    transcript: traceOnError.transcript,
    context: traceOnError.context,
  }
}
