import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildBackendApp } from '../app.js'
import type {
  RawExchangeRecord,
  SessionRecord,
} from '../domain/model.js'
import type { SessionTraceBundle } from '../domain/trace.js'
export type { SessionTraceBundle } from '../domain/trace.js'
import {
  parseChatCompletionStream,
  type AssistantSegment,
  type OaiChatCompletionResponse,
  type PromptProbeResult,
  type OaiStreamedChatCompletionResult,
} from '../services/lmstudio/client.js'
import type { McpGateway } from '../runtime/toolTurns.js'
import type { ChatCompletionGateway } from '../runtime/modelTurns.js'

type RawExchangePair = {
  request: RawExchangeRecord
  response: RawExchangeRecord
}

type ReplayResult = {
  replayedTrace: SessionTraceBundle
}

function makeSqlitePath() {
  return path.join('.tmp-test-data', `replay-trace-${crypto.randomUUID()}`, 'test.db')
}

function parseJsonBody(text: string | null): unknown {
  return text == null ? null : JSON.parse(text)
}

function parseMcpRpcBody(text: string | null): {
  jsonrpc?: string
  id?: number
  result?: unknown
  error?: {
    code: number
    message: string
  }
} {
  if (!text || !text.trim()) {
    return { jsonrpc: '2.0', id: -1, result: null }
  }

  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as {
      jsonrpc?: string
      id?: number
      result?: unknown
      error?: {
        code: number
        message: string
      }
    }
  }

  const dataLine = trimmed
    .split('\n')
    .find(line => line.startsWith('data:'))

  if (!dataLine) {
    throw new Error('Stored MCP raw response did not contain JSON or SSE data')
  }

  return JSON.parse(dataLine.slice(5).trim()) as {
    jsonrpc?: string
    id?: number
    result?: unknown
    error?: {
      code: number
      message: string
    }
  }
}

function segmentsFromCompletion(completion: OaiChatCompletionResponse): AssistantSegment[] {
  const responseMessage = completion.choices[0]?.message
  const segments: AssistantSegment[] = []

  if (responseMessage?.reasoning_content?.length) {
    segments.push({
      kind: 'reasoning',
      text: responseMessage.reasoning_content,
    })
  }

  if (responseMessage?.content?.length) {
    segments.push({
      kind: 'content',
      text: responseMessage.content,
    })
  }

  responseMessage?.tool_calls?.forEach((_toolCall, index) => {
    segments.push({
      kind: 'tool-call',
      toolCallIndex: index,
    })
  })

  return segments
}

function parseRecordedLmResponse(responseBody: string | null): OaiStreamedChatCompletionResult {
  const text = responseBody ?? ''
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    const completion = JSON.parse(trimmed) as OaiChatCompletionResponse
    return {
      completion,
      segments: segmentsFromCompletion(completion),
      rawResponseBody: text,
      chunks: [],
    }
  }

  return parseChatCompletionStream(text)
}

function pairRawExchanges(
  rawExchanges: RawExchangeRecord[],
  requestKind: RawExchangeRecord['kind'],
  responseKind: RawExchangeRecord['kind'],
): RawExchangePair[] {
  const pairs: RawExchangePair[] = []
  let pending: RawExchangeRecord | null = null

  for (const exchange of rawExchanges) {
    if (exchange.kind === requestKind) {
      if (pending) {
        throw new Error(`Unpaired ${requestKind} exchange in trace`)
      }
      pending = exchange
      continue
    }

    if (exchange.kind !== responseKind) {
      continue
    }

    if (!pending) {
      throw new Error(`Encountered ${responseKind} without matching ${requestKind}`)
    }

    pairs.push({
      request: pending,
      response: exchange,
    })
    pending = null
  }

  if (pending) {
    throw new Error(`Trace ended with unpaired ${requestKind}`)
  }

  return pairs
}

function normalizedSession(session: SessionRecord) {
  return {
    title: session.title,
    status: session.status,
    initStatus: session.initStatus,
    modelProfileSnapshot: session.modelProfileSnapshot,
    mcpProfileSnapshots: session.mcpProfileSnapshots,
    loadedContextLength: session.loadedContextLength,
    systemPromptTokens: session.systemPromptTokens,
    toolDefinitionsTokens: session.toolDefinitionsTokens,
    isContextExhausted: session.isContextExhausted,
    compactionStrategy: session.compactionStrategy,
  }
}

function normalizeTraceBundle(trace: SessionTraceBundle) {
  const turnRefById = new Map(trace.turns.map(turn => [turn.id, `turn-${turn.turnNumber}`]))
  const stepRefById = new Map(trace.steps.map((step, i) => [step.id, `step-${i + 1}`]))
  const roundRefById = new Map(
    trace.rounds.map(round => [round.id, `${turnRefById.get(round.turnId) ?? 'turn-unknown'}-round-${round.roundIndex}`]),
  )
  const partRefById = new Map(trace.parts.map(part => [part.id, `part-${part.ordinal}`]))

  return {
    session: normalizedSession(trace.session),
    turns: trace.turns.map(turn => ({
      turnNumber: turn.turnNumber,
      status: turn.status,
      outcome: turn.outcome,
      usage: turn.usage,
      compactionApplied: turn.compactionApplied,
      contextTokensAtTurnEnd: turn.contextTokensAtTurnEnd,
      contextTokensAfterCompaction: turn.contextTokensAfterCompaction,
      compactionTokensRemoved: turn.compactionTokensRemoved,
    })),
    rounds: trace.rounds.map(round => ({
      turnRef: turnRefById.get(round.turnId) ?? null,
      roundIndex: round.roundIndex,
      status: round.status,
      finishReason: round.finishReason,
      usage: round.usage,
      requestPayloadJson: round.requestPayloadJson,
      responseTraceJson: round.responseTraceJson,
    })),
    parts: trace.parts.map(part => ({
      turnRef: part.turnId ? (turnRefById.get(part.turnId) ?? null) : null,
      roundRef: part.roundId ? (roundRefById.get(part.roundId) ?? null) : null,
      parentPartRef: part.parentPartId ? (partRefById.get(part.parentPartId) ?? null) : null,
      ordinal: part.ordinal,
      partType: part.partType,
      roleLabel: part.roleLabel,
      payload: part.payload,
      display: part.display,
      context: {
        state: part.context.state,
        note: part.context.note,
        strippedByCompactionAtTurnRef: part.context.strippedByCompactionAtTurnId
          ? (stepRefById.get(part.context.strippedByCompactionAtTurnId)
            ?? ((): string => { const parts = part.context.strippedByCompactionAtTurnId.split('.'); return parts.length >= 2 ? parts[parts.length - 1]! : part.context.strippedByCompactionAtTurnId })())
          : null,
      },
      tokens: part.tokens,
      provenanceJson: part.provenanceJson,
    })),
    rawExchanges: trace.rawExchanges.map(exchange => ({
      turnRef: exchange.turnId ? (turnRefById.get(exchange.turnId) ?? null) : null,
      roundRef: exchange.roundId ? (roundRefById.get(exchange.roundId) ?? null) : null,
      kind: exchange.kind,
      requestUrl: exchange.requestUrl,
      requestMethod: exchange.requestMethod,
      requestHeadersJson: exchange.requestHeadersJson,
      requestBody: exchange.requestBody,
      responseStatus: exchange.responseStatus,
      responseHeadersJson: exchange.responseHeadersJson,
      responseBody: exchange.responseBody,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    transcript: trace.transcript.map(entry => {
      const record = entry as {
        turnId?: string | null
        roundId?: string | null
        type?: unknown
        roleLabel?: unknown
        text?: unknown
        summary?: unknown
        tokens?: unknown
        context?: { state?: unknown; note?: unknown; strippedByCompactionAtTurnId?: string | null } | null
      }
      return {
        turnRef: record.turnId ? (turnRefById.get(record.turnId) ?? null) : null,
        roundRef: record.roundId ? (roundRefById.get(record.roundId) ?? null) : null,
        type: record.type ?? null,
        roleLabel: record.roleLabel ?? null,
        text: record.text ?? null,
        summary: record.summary ?? null,
        tokens: record.tokens ?? null,
        context: record.context
          ? {
              state: record.context.state ?? null,
              note: record.context.note ?? null,
              strippedByCompactionAtTurnRef: record.context.strippedByCompactionAtTurnId
                ? (stepRefById.get(record.context.strippedByCompactionAtTurnId) ?? record.context.strippedByCompactionAtTurnId.split('.').slice(-1)[0])
                : null,
            }
          : null,
      }
    }),
    context: trace.context.map(entry => {
      const record = entry as {
        turnId?: string | null
        roundId?: string | null
        type?: unknown
        roleLabel?: unknown
        text?: unknown
        summary?: unknown
        tokens?: unknown
      }
      return {
        turnRef: record.turnId ? (turnRefById.get(record.turnId) ?? null) : null,
        roundRef: record.roundId ? (roundRefById.get(record.roundId) ?? null) : null,
        type: record.type ?? null,
        roleLabel: record.roleLabel ?? null,
        text: record.text ?? null,
        summary: record.summary ?? null,
        tokens: record.tokens ?? null,
      }
    }),
  }
}

function createReplayChatCompletionGateway(trace: SessionTraceBundle): ChatCompletionGateway {
  const probePairs = pairRawExchanges(trace.rawExchanges, 'lmstudio-probe-request', 'lmstudio-probe-response')
  const streamedPairs = pairRawExchanges(trace.rawExchanges, 'lmstudio-request', 'lmstudio-response')
  let probeIndex = 0
  let streamedIndex = 0

  return {
    async createChatCompletion() {
      throw new Error('Replay harness expects streamed completions or recorded prompt probes only')
    },
    async probePromptTokensDetailed(baseUrl, _apiKey, body): Promise<PromptProbeResult> {
      const pair = probePairs[probeIndex]
      if (!pair) {
        throw new Error('Replay trace exhausted LM Studio probe exchanges')
      }
      probeIndex += 1

      assert.equal(pair.request.requestUrl, `${baseUrl.replace(/\/$/, '')}/chat/completions`)
      assert.deepEqual(body, parseJsonBody(pair.request.requestBody))

      const completion = parseJsonBody(pair.response.responseBody) as OaiChatCompletionResponse
      return {
        promptTokens: completion.usage?.prompt_tokens ?? null,
        completion,
        rawExchange: {
          requestUrl: pair.request.requestUrl,
          requestMethod: pair.request.requestMethod,
          requestHeadersJson: pair.request.requestHeadersJson as Record<string, string> | null,
          requestBody: pair.request.requestBody,
          responseStatus: pair.response.responseStatus,
          responseHeadersJson: pair.response.responseHeadersJson as Record<string, string> | null,
          responseBody: pair.response.responseBody,
        },
      }
    },
    async streamChatCompletion(baseUrl, _apiKey, body) {
      const pair = streamedPairs[streamedIndex]
      if (!pair) {
        throw new Error('Replay trace exhausted LM Studio streamed exchanges')
      }
      streamedIndex += 1

      assert.equal(pair.request.requestUrl, `${baseUrl.replace(/\/$/, '')}/chat/completions`)
      assert.deepEqual(body, parseJsonBody(pair.request.requestBody))
      return parseRecordedLmResponse(pair.response.responseBody)
    },
  }
}

function createReplayMcpGateway(trace: SessionTraceBundle): McpGateway {
  const mcpPairs = pairRawExchanges(trace.rawExchanges, 'mcp-request', 'mcp-response')
  const initializePairs: RawExchangePair[] = []
  const listToolsPairs: RawExchangePair[] = []
  const callToolPairs: RawExchangePair[] = []

  for (const pair of mcpPairs) {
    const requestJson = parseJsonBody(pair.request.requestBody) as {
      method?: string
      params?: {
        name?: string
        arguments?: Record<string, unknown>
      }
    } | null
    const method = requestJson?.method
    if (method === 'initialize') {
      initializePairs.push(pair)
      continue
    }
    if (method === 'tools/list') {
      listToolsPairs.push(pair)
      continue
    }
    if (method === 'tools/call') {
      callToolPairs.push(pair)
      continue
    }
  }

  let initializeIndex = 0
  let listToolsIndex = 0
  let callToolIndex = 0

  return {
    async initializeSession(serverUrl) {
      const pair = initializePairs[initializeIndex]
      if (!pair) {
        throw new Error('Replay trace exhausted MCP initialize exchanges')
      }
      initializeIndex += 1

      assert.equal(pair.request.requestUrl, serverUrl.replace(/\/$/, ''))
      const rpc = parseMcpRpcBody(pair.response.responseBody)
      const result = (rpc.result ?? {}) as {
        serverInfo?: {
          name?: string
          version?: string
        }
        protocolVersion?: string
        instructions?: string
      }

      return {
        sessionId: (pair.response.responseHeadersJson as { 'mcp-session-id'?: string } | null)?.['mcp-session-id'] ?? null,
        instructions: result.instructions,
        rawExchange: {
          requestUrl: pair.request.requestUrl,
          requestMethod: pair.request.requestMethod,
          requestHeaders: pair.request.requestHeadersJson as Record<string, string> | null,
          requestBodyText: pair.request.requestBody ?? '',
          responseStatus: pair.response.responseStatus ?? 200,
          responseHeaders: pair.response.responseHeadersJson as Record<string, string> | null,
          responseBodyText: pair.response.responseBody,
          responseBody: rpc,
        },
      }
    },
    async listTools(serverUrl) {
      const pair = listToolsPairs[listToolsIndex]
      if (!pair) {
        throw new Error('Replay trace exhausted MCP tools/list exchanges')
      }
      listToolsIndex += 1

      assert.equal(pair.request.requestUrl, serverUrl.replace(/\/$/, ''))
      const rpc = parseMcpRpcBody(pair.response.responseBody)
      const result = (rpc.result ?? {}) as {
        tools?: Array<{
          name?: string
          description?: string
          inputSchema?: unknown
        }>
      }

      return {
        tools: (result.tools ?? []).map(tool => ({
          name: tool.name ?? 'unknown',
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        rawResult: rpc,
        rawExchange: {
          requestUrl: pair.request.requestUrl,
          requestMethod: pair.request.requestMethod,
          requestHeaders: pair.request.requestHeadersJson as Record<string, string> | null,
          requestBodyText: pair.request.requestBody ?? '',
          responseStatus: pair.response.responseStatus ?? 200,
          responseHeaders: pair.response.responseHeadersJson as Record<string, string> | null,
          responseBodyText: pair.response.responseBody,
          responseBody: rpc,
        },
      }
    },
    async callTool(serverUrl, _sessionId, name, args) {
      const pair = callToolPairs[callToolIndex]
      if (!pair) {
        throw new Error('Replay trace exhausted MCP tools/call exchanges')
      }
      callToolIndex += 1

      assert.equal(pair.request.requestUrl, serverUrl.replace(/\/$/, ''))
      const requestJson = parseJsonBody(pair.request.requestBody) as {
        params?: {
          name?: string
          arguments?: Record<string, unknown>
        }
      } | null
      assert.equal(requestJson?.params?.name, name)
      assert.deepEqual(requestJson?.params?.arguments ?? {}, args)

      const rpc = parseMcpRpcBody(pair.response.responseBody)
      const result = (rpc.result ?? {}) as {
        content?: Array<{ type?: string; text?: string }>
        structuredContent?: unknown
        isError?: boolean
      }

      return {
        content: (result.content ?? [])
          .map(item => (item.type === 'text' ? (item.text ?? '') : `[${item.type ?? 'unknown'} content]`))
          .join('\n'),
        structuredContent: result.structuredContent ?? null,
        isError: result.isError === true,
        rawResult: rpc,
        rawExchange: {
          requestUrl: pair.request.requestUrl,
          requestMethod: pair.request.requestMethod,
          requestHeaders: pair.request.requestHeadersJson as Record<string, string> | null,
          requestBodyText: pair.request.requestBody ?? '',
          responseStatus: pair.response.responseStatus ?? 200,
          responseHeaders: pair.response.responseHeadersJson as Record<string, string> | null,
          responseBodyText: pair.response.responseBody,
          responseBody: rpc,
        },
      }
    },
  }
}

export async function replayTrace(trace: SessionTraceBundle): Promise<ReplayResult> {
  const sqlitePath = makeSqlitePath()
  const app = await buildBackendApp(
    {
      host: '127.0.0.1',
      port: 3030,
      corsOrigin: true,
      dataDir: path.dirname(sqlitePath),
      sqlitePath,
      maxToolRounds: Math.max(1, trace.rounds.length + 2),
    },
    {
      chatCompletionGateway: createReplayChatCompletionGateway(trace),
      mcpGateway: createReplayMcpGateway(trace),
    },
  )

  try {
    const createSessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: trace.session.title,
        modelProfileSnapshot: trace.session.modelProfileSnapshot,
        mcpProfileSnapshots: trace.session.mcpProfileSnapshots,
      },
    })
    assert.equal(createSessionResponse.statusCode, 201)

    const sessionId = createSessionResponse.json().session.id as string
    const userTurns = trace.turns
      .slice()
      .sort((a, b) => a.turnNumber - b.turnNumber)
      .map(turn => {
        const userPart = trace.parts
          .filter(part => part.turnId === turn.id && part.partType === 'user-message')
          .sort((a, b) => a.ordinal - b.ordinal)[0]
        if (!userPart?.payload.text) {
          throw new Error(`Trace turn ${turn.turnNumber} is missing its user-message payload`)
        }
        return userPart.payload.text
      })

    for (const userContent of userTurns) {
      const turnResponse = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/turns`,
        payload: {
          userContent,
        },
      })
      assert.equal(turnResponse.statusCode, 201)
    }

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/trace`,
    })
    assert.equal(traceResponse.statusCode, 200)

    return {
      replayedTrace: traceResponse.json() as SessionTraceBundle,
    }
  } finally {
    await app.close()
    fs.rmSync(path.dirname(sqlitePath), { recursive: true, force: true })
  }
}

export async function expectTraceToReplay(trace: SessionTraceBundle): Promise<void> {
  const replayed = await replayTrace(trace)
  assert.deepEqual(
    normalizeTraceBundle(replayed.replayedTrace),
    normalizeTraceBundle(trace),
  )
}
