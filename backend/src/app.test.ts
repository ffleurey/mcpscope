import fs from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildBackendApp } from './app.js'
import type { SessionTraceBundle } from './domain/trace.js'
import {
  capturedReasoningThreeBatchParts,
  capturedReasoningThreeBatchRounds,
  capturedReasoningThreeBatchSession,
} from './testing/fixtures/capturedReasoningThreeBatch.js'

function makeTestConfig() {
  const dataDir = `.tmp-test-data/${crypto.randomUUID()}`
  return {
    host: '127.0.0.1',
    port: 3030,
    corsOrigin: true as const,
    dataDir,
    sqlitePath: `${dataDir}/test.db`,
    maxToolRounds: 5,
    appVersion: 'test',
  }
}

function parseSseEvents(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map(block => {
      const eventLine = block.split('\n').find(line => line.startsWith('event:'))
      const dataLine = block.split('\n').find(line => line.startsWith('data:'))
      return {
        event: eventLine?.slice(6).trim() ?? 'message',
        data: JSON.parse(dataLine?.slice(5).trim() ?? '{}') as Record<string, unknown>,
      }
    })
}


describe('backend foundation', () => {
  let app: FastifyInstance | undefined
  let dataDir: string | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true })
      dataDir = undefined
    }
  })

  it('serves a health endpoint', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'mcpscope-backend',
    })
  })

  it('exposes the canonical backend domain model and schema', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const response = await app.inject({
      method: 'GET',
      url: '/api/domain-model',
    })

    expect(response.statusCode).toBe(200)

    const body = response.json()
    expect(body).toMatchObject({
      version: 1,
      entities: ['session', 'turn', 'round', 'part', 'raw-exchange'],
    })
    expect(body.schema.tables).toEqual(
      expect.arrayContaining(['sessions', 'turns', 'rounds', 'parts', 'raw_exchanges'])
    )
    expect(body.schema.meta).toMatchObject({
      domain_model_version: '1',
      sqlite_schema_version: '4',
    })
  })


  it('lists sessions in reverse updated order and deletes them through the backend API', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'First Session',
        modelProfileSnapshot: {
          id: 'model-1',
          name: 'Model',
          connectionBaseUrl: 'https://example.com/v1',
          apiKey: null,
          modelKey: 'model-key',
          modelDisplayName: 'Model Key',
          systemPrompt: 'Reply exactly.',
          temperature: 0,
          reasoning: 'on',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })
    expect(firstResponse.statusCode).toBe(201)

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Second Session',
        modelProfileSnapshot: {
          id: 'model-2',
          name: 'Model',
          connectionBaseUrl: 'https://example.com/v1',
          apiKey: null,
          modelKey: 'model-key',
          modelDisplayName: 'Model Key',
          systemPrompt: 'Reply exactly.',
          temperature: 0,
          reasoning: 'on',
          createdAt: 2,
          updatedAt: 2,
        },
      },
    })
    expect(secondResponse.statusCode).toBe(201)

    const firstSessionId = firstResponse.json().session.id as string
    const secondSessionId = secondResponse.json().session.id as string

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions',
    })
    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json().sessions.map((session: { id: string }) => session.id)).toEqual([
      secondSessionId,
      firstSessionId,
    ])

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${firstSessionId}`,
    })
    expect(deleteResponse.statusCode).toBe(204)

    const deletedTraceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${firstSessionId}/trace`,
    })
    expect(deletedTraceResponse.statusCode).toBe(404)

    const listAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/sessions',
    })
    expect(listAfterDelete.statusCode).toBe(200)
    expect(listAfterDelete.json().sessions.map((session: { id: string }) => session.id)).toEqual([
      secondSessionId,
    ])
  })

  it('supports explicit session IDs and validates duplicates/format', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const createPayload = {
      sessionId: 'AB23',
      title: 'With explicit ID',
      modelProfileSnapshot: {
        id: 'model-1',
        name: 'Model',
        connectionBaseUrl: 'https://example.com/v1',
        apiKey: null,
        modelKey: 'model-key',
        modelDisplayName: 'Model Key',
        systemPrompt: 'Reply exactly.',
        temperature: 0,
        reasoning: 'on',
        createdAt: 1,
        updatedAt: 1,
      },
    }

    const first = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: createPayload,
    })
    expect(first.statusCode).toBe(201)
    expect(first.json().session.id).toBe('AB23')

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: createPayload,
    })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error.code).toBe('duplicate_session_id')

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        ...createPayload,
        sessionId: 'OOO1',
      },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('invalid_session_id')
  })

  it('stores backend-owned LM connections, model configs, and MCP profiles', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const lmConnection = {
      id: 'lm-1',
      name: 'Local LM Studio',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      createdAt: 1,
      updatedAt: 2,
    }
    const modelConfig = {
      id: 'model-config-1',
      name: 'Primary model',
      connectionId: 'lm-1',
      modelKey: 'qwen-1',
      modelDisplayName: 'Qwen 1',
      systemPrompt: 'Reply exactly.',
      temperature: 0,
      reasoning: 'on' as const,
      createdAt: 3,
      updatedAt: 4,
    }
    const mcpProfile = {
      id: 'mcp-1',
      name: 'Local MCP',
      url: 'http://localhost:3001/mcp',
      transport: 'streamable-http' as const,
      authType: 'bearer' as const,
      authValue: 'token-1',
      createdAt: 5,
      updatedAt: 6,
    }

    expect((await app.inject({
      method: 'PUT',
      url: '/api/lm-connections/lm-1',
      payload: lmConnection,
    })).statusCode).toBe(200)

    expect((await app.inject({
      method: 'PUT',
      url: '/api/model-configs/model-config-1',
      payload: modelConfig,
    })).statusCode).toBe(200)

    expect((await app.inject({
      method: 'PUT',
      url: '/api/mcp-profiles/mcp-1',
      payload: mcpProfile,
    })).statusCode).toBe(200)

    const connectionsResponse = await app.inject({
      method: 'GET',
      url: '/api/lm-connections',
    })
    expect(connectionsResponse.statusCode).toBe(200)
    expect(connectionsResponse.json().lmConnections).toEqual([lmConnection])

    const modelConfigsResponse = await app.inject({
      method: 'GET',
      url: '/api/model-configs',
    })
    expect(modelConfigsResponse.statusCode).toBe(200)
    expect(modelConfigsResponse.json().modelConfigs).toEqual([modelConfig])

    const mcpProfilesResponse = await app.inject({
      method: 'GET',
      url: '/api/mcp-profiles',
    })
    expect(mcpProfilesResponse.statusCode).toBe(200)
    expect(mcpProfilesResponse.json().mcpProfiles).toEqual([mcpProfile])

    expect((await app.inject({
      method: 'DELETE',
      url: '/api/lm-connections/lm-1',
    })).statusCode).toBe(204)
    expect((await app.inject({
      method: 'DELETE',
      url: '/api/model-configs/model-config-1',
    })).statusCode).toBe(204)
    expect((await app.inject({
      method: 'DELETE',
      url: '/api/mcp-profiles/mcp-1',
    })).statusCode).toBe(204)
  })

  it('imports a captured multi-round trace bundle and re-exposes it through the canonical trace API', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const capturedTrace: SessionTraceBundle = {
      session: capturedReasoningThreeBatchSession,
      turns: [
        {
          id: capturedReasoningThreeBatchRounds[0]!.turnId,
          sessionId: capturedReasoningThreeBatchSession.id,
          sequenceNumber: 1,
          status: 'complete',
          createdAt: 1,
          completedAt: 8,
          outcome: 'tool-assisted-response',
          usage: {
            promptTokens: 9640,
            completionTokens: 2246,
            reasoningTokens: 1723,
            totalTokens: 11886,
          },
          contextTokensAtTurnEnd: null,
          contextTokensAfterCompaction: null,
          compactionApplied: null,
          compactionTokensRemoved: null,
        },
      ],
      rounds: capturedReasoningThreeBatchRounds,
      parts: capturedReasoningThreeBatchParts,
      rawExchanges: [],
      transcript: [],
      context: [],
    }

    const importResponse = await app.inject({
      method: 'POST',
      url: '/api/traces/import',
      payload: capturedTrace,
    })
    expect(importResponse.statusCode).toBe(201)
    const importedSessionId = importResponse.json().session.id as string
    expect(importedSessionId).not.toBe(capturedReasoningThreeBatchSession.id)

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${importedSessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    const traceBody = traceResponse.json()

    expect(traceBody.turns).toHaveLength(1)
    expect(traceBody.rounds).toHaveLength(4)
    expect(traceBody.parts).toHaveLength(capturedReasoningThreeBatchParts.length)
    expect(traceBody.transcript.filter((entry: { type: string }) => entry.type === 'assistant-reasoning')).toHaveLength(4)
    expect(traceBody.context.some((entry: { type: string }) => entry.type === 'assistant-reasoning')).toBe(false)
    expect(traceBody.parts.filter((part: { partType: string }) => part.partType === 'tool-call')).toHaveLength(6)
    expect(traceBody.parts.filter((part: { partType: string }) => part.partType === 'tool-result')).toHaveLength(6)
  })

  it('returns expected lookup payloads for session/turn/round/part on exported multi-turn tool baseline', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)
    const baselineTrace = JSON.parse(
      fs.readFileSync(
        'exports/test-with-multiple-turns-and-tools.trace.json',
        'utf8',
      ),
    ) as SessionTraceBundle
    const importResponse = await app.inject({
      method: 'POST',
      url: '/api/traces/import',
      payload: baselineTrace,
    })
    expect(importResponse.statusCode).toBe(201)
    const importedSessionId = importResponse.json().session.id as string
    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${importedSessionId}/trace`,
    })
      expect(traceResponse.statusCode).toBe(200)
      const traceBody = traceResponse.json()
      const turns = [...traceBody.turns].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      const firstTurnId = turns[0].id as string
      const secondTurnId = turns[1].id as string
      const targetTurnId = turns[2]?.id as string
      const rounds = traceBody.rounds as Array<{ id: string; turnId: string; roundIndex: number }>
      const parts = traceBody.parts as Array<{
        id: string
        roundId: string | null
        turnId: string | null
        partType: string
        payload: { json: Record<string, unknown> | null }
      }>
      const firstRoundId = rounds.find(round => round.turnId === firstTurnId && round.roundIndex === 0)?.id
      const targetRound = rounds.find((round) => (
        round.turnId === targetTurnId
        && parts.filter(part => part.roundId === round.id && part.partType === 'tool-call').length > 0
      )) ?? rounds.find((round) => (
        parts.filter(part => part.roundId === round.id && part.partType === 'tool-call').length > 0
      ))
      expect(targetRound).toBeDefined()
      expect(firstRoundId).toBeDefined()
      const targetRoundId = targetRound!.id
      const toolCallPart = parts.find((part) =>
        part.roundId === targetRoundId && part.partType === 'tool-call',
      )
      const toolCallPartId = toolCallPart?.id as string
      const assistantContentPartId = parts.find((part) => part.roundId === targetRoundId && part.partType === 'assistant-content')?.id as string
      const userPromptPartId = parts.find((part) => part.partType === 'user-message')?.id as string
      const setupPartId = parts.find((part) => part.turnId === null && part.partType === 'system-prompt')?.id as string
      const toolName = (toolCallPart?.payload.json?.toolName ?? toolCallPart?.payload.json?.name) as string | undefined
      expect(setupPartId).toBeDefined()
      expect(userPromptPartId).toBeDefined()

    const sessionSummary = await app.inject({ method: 'GET', url: `/api/lookup/${importedSessionId}?mode=summary` })
    expect(sessionSummary.statusCode).toBe(200)
    expect(sessionSummary.json()).toMatchObject({
      id: importedSessionId,
      type: 'session',
      mode: 'summary',
      data: {
        id: importedSessionId,
        title: expect.any(String),
        model: { name: expect.any(String), key: expect.any(String) },
        context_window: { available: expect.anything() },
        setup: { id: expect.any(String), parts: expect.any(Array) },
        turns: expect.arrayContaining([
          expect.objectContaining({ id: firstTurnId, number: 1 }),
          expect.objectContaining({ id: secondTurnId, number: 2 }),
        ]),
      },
    })
    expect(sessionSummary.json().parentIds).toBeUndefined()

    const sessionFull = await app.inject({ method: 'GET', url: `/api/lookup/${importedSessionId}?mode=full` })
    expect(sessionFull.statusCode).toBe(200)
    expect(sessionFull.json()).toMatchObject({
      id: importedSessionId,
      type: 'session',
      mode: 'full',
      data: {
        id: importedSessionId,
        model: { name: expect.any(String) },
        setup: { parts: expect.any(Array) },
        turns: expect.any(Array),
      },
    })
    expect(sessionFull.json().parentIds).toBeUndefined()
    expect(sessionFull.json().data.session).toBeUndefined()
    expect(sessionFull.json().data.context).toBeUndefined()
    // Setup parts embedded in session full must not include content — only direct setup/part lookups do
    const sessionFullSetupParts: { content?: unknown }[] = sessionFull.json().data.setup.parts
    expect(sessionFullSetupParts.every(p => p.content === undefined)).toBe(true)

    const turnSummary = await app.inject({ method: 'GET', url: `/api/lookup/${firstTurnId}?mode=summary` })
    expect(turnSummary.statusCode).toBe(200)
    expect(turnSummary.json()).toMatchObject({
      id: firstTurnId,
      type: 'turn',
      mode: 'summary',
      data: {
        id: firstTurnId,
        number: 1,
        rounds: expect.arrayContaining([
          expect.objectContaining({ id: expect.any(String), number: 1 }),
        ]),
      },
    })
    expect(turnSummary.json().parentIds).toBeUndefined()
    expect(turnSummary.json().data.turn).toBeUndefined()

    const turnFull = await app.inject({ method: 'GET', url: `/api/lookup/${firstTurnId}?mode=full` })
    expect(turnFull.statusCode).toBe(200)
    expect(turnFull.json()).toMatchObject({
      id: firstTurnId,
      type: 'turn',
      mode: 'full',
      data: {
        id: firstTurnId,
        number: 1,
        rounds: expect.any(Array),
      },
    })
    expect(turnFull.json().parentIds).toBeUndefined()
    expect(turnFull.json().data.turn).toBeUndefined()
    expect(turnFull.json().data.context).toBeUndefined()
    expect(turnFull.json().data.rounds.length).toBeGreaterThan(0)

    const firstRoundSummary = await app.inject({ method: 'GET', url: `/api/lookup/${firstRoundId}?mode=summary` })
    expect(firstRoundSummary.statusCode).toBe(200)
    expect(firstRoundSummary.json().data.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'user_prompt', token_count: expect.anything() }),
      ]),
    )

    const roundSummary = await app.inject({ method: 'GET', url: `/api/lookup/${targetRoundId}?mode=summary` })
    expect(roundSummary.statusCode).toBe(200)
    expect(roundSummary.json()).toMatchObject({
      id: targetRoundId,
      type: 'round',
      mode: 'summary',
      data: {
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'tool_call', tool_name: expect.any(String) }),
        ]),
      },
    })
    expect(roundSummary.json().parentIds).toBeUndefined()
    const roundSummaryTool = roundSummary.json().data.parts.find((p: { type: string }) => p.type === 'tool_call')
    expect(roundSummaryTool.tool_payload).toBeUndefined()

    const roundFull = await app.inject({ method: 'GET', url: `/api/lookup/${targetRoundId}?mode=full` })
    expect(roundFull.statusCode).toBe(200)
    expect(roundFull.json()).toMatchObject({
      id: targetRoundId,
      type: 'round',
      mode: 'full',
      data: {
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'tool_call', tool_name: expect.any(String) }),
        ]),
      },
    })
    expect(roundFull.json().parentIds).toBeUndefined()
    expect(roundFull.json().data.parts.length).toBeGreaterThan(0)
    // tool_payload only on direct part lookup, not at round level
    const roundFullTool = roundFull.json().data.parts.find((p: { type: string }) => p.type === 'tool_call')
    expect(roundFullTool.tool_payload).toBeUndefined()
    // no setup-type parts appear in round parts
    expect(roundFull.json().data.parts.some((p: { type: string }) => p.type === 'setup')).toBe(false)

    const partSummary = await app.inject({ method: 'GET', url: `/api/lookup/${toolCallPartId}?mode=summary` })
    expect(partSummary.statusCode).toBe(200)
    expect(partSummary.json()).toMatchObject({
      id: toolCallPartId,
      type: 'part',
      mode: 'summary',
      data: expect.objectContaining({
        id: toolCallPartId,
        type: 'tool_call',
        ...(toolName ? { tool_name: toolName } : {}),
        token_count: expect.anything(),
        context_state: expect.any(String),
      }),
    })
    expect(partSummary.json().parentIds).toBeUndefined()
    expect(partSummary.json().data.tool_payload).toBeUndefined()

    const partFull = await app.inject({ method: 'GET', url: `/api/lookup/${toolCallPartId}?mode=full` })
    expect(partFull.statusCode).toBe(200)
    expect(partFull.json()).toMatchObject({
      id: toolCallPartId,
      type: 'part',
      mode: 'full',
      data: expect.objectContaining({
        id: toolCallPartId,
        type: 'tool_call',
        ...(toolName ? { tool_name: toolName } : {}),
        context_state: expect.any(String),
        tool_payload: expect.objectContaining({ call: expect.any(Object) }),
      }),
    })
    expect(partFull.json().parentIds).toBeUndefined()

    if (assistantContentPartId) {
      const assistantPartSummary = await app.inject({ method: 'GET', url: `/api/lookup/${assistantContentPartId}?mode=summary` })
      expect(assistantPartSummary.statusCode).toBe(200)
      expect(assistantPartSummary.json().data.content).toBeUndefined()

      const assistantPartFull = await app.inject({ method: 'GET', url: `/api/lookup/${assistantContentPartId}?mode=full` })
      expect(assistantPartFull.statusCode).toBe(200)
      expect(assistantPartFull.json().data.content).toEqual(
        expect.objectContaining({ text: expect.any(String) }),
      )
    }

    const userPromptPartSummary = await app.inject({ method: 'GET', url: `/api/lookup/${userPromptPartId}?mode=summary` })
    expect(userPromptPartSummary.statusCode).toBe(200)
    expect(userPromptPartSummary.json().data).toEqual(
      expect.objectContaining({ type: 'user_prompt', token_count: expect.anything() }),
    )
    expect(userPromptPartSummary.json().data.content).toBeUndefined()

    // Setup node lookup
    const setupId = `${importedSessionId}.S`
    const setupNodeFull = await app.inject({ method: 'GET', url: `/api/lookup/${setupId}?mode=full` })
    expect(setupNodeFull.statusCode).toBe(200)
    expect(setupNodeFull.json()).toMatchObject({
      id: setupId,
      type: 'setup',
      mode: 'full',
      data: {
        id: setupId,
        parts: expect.arrayContaining([
          expect.objectContaining({
            type: 'system_prompt',
            content: expect.objectContaining({ text: expect.any(String) }),
          }),
        ]),
      },
    })

    const setupPartSummary = await app.inject({ method: 'GET', url: `/api/lookup/${setupPartId}?mode=summary` })
    expect(setupPartSummary.statusCode).toBe(200)
    expect(setupPartSummary.json()).toMatchObject({
      id: setupPartId,
      type: 'part',
      mode: 'summary',
      data: expect.objectContaining({
        id: setupPartId,
        type: 'system_prompt',
        token_count: expect.anything(),
        context_state: expect.any(String),
      }),
    })
    expect(setupPartSummary.json().parentIds).toBeUndefined()
    expect(setupPartSummary.json().data.content).toBeUndefined()

    const setupPartFull = await app.inject({ method: 'GET', url: `/api/lookup/${setupPartId}?mode=full` })
    expect(setupPartFull.statusCode).toBe(200)
    expect(setupPartFull.json()).toMatchObject({
      id: setupPartId,
      type: 'part',
      mode: 'full',
      data: expect.objectContaining({
        id: setupPartId,
        type: 'system_prompt',
        context_state: expect.any(String),
        content: expect.objectContaining({ text: expect.any(String) }),
      }),
    })
    expect(setupPartFull.json().parentIds).toBeUndefined()

    const invalidLookup = await app.inject({ method: 'GET', url: '/api/lookup/not-an-id?mode=summary' })
    expect(invalidLookup.statusCode).toBe(400)
  })

  it('streams model-only turn events as deltas followed by committed parts', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config, {
      lmStudioGateway: {
        async probePromptTokensDetailed(_baseUrl, _apiKey, body) {
          return {
            promptTokens: 3,
            completion: {
              id: 'probe-cmpl-1',
              model: 'model-key',
              created: 122,
              choices: [],
              usage: {
                prompt_tokens: 3,
                completion_tokens: 0,
                total_tokens: 3,
              },
            },
            rawExchange: {
              requestUrl: 'https://example.com/v1/chat/completions',
              requestMethod: 'POST',
              requestHeadersJson: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              requestBody: JSON.stringify(body),
              responseStatus: 200,
              responseHeadersJson: {
                'content-type': 'application/json',
              },
              responseBody: JSON.stringify({
                id: 'probe-cmpl-1',
                usage: { prompt_tokens: 3 },
              }),
            },
          }
        },
        async createChatCompletion() {
          throw new Error('not used')
        },
        async streamChatCompletion(_baseUrl, _apiKey, _body, callbacks) {
          callbacks?.onDelta?.({
            kind: 'reasoning',
            textDelta: 'Because the answer is simple.',
          })
          callbacks?.onDelta?.({
            kind: 'content',
            textDelta: 'OK',
          })
          return {
            completion: {
              id: 'cmpl-1',
              model: 'model-key',
              created: 123,
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    reasoning_content: 'Because the answer is simple.',
                    content: 'OK',
                  },
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 6,
                total_tokens: 16,
                completion_tokens_details: {
                  reasoning_tokens: 4,
                },
              },
            },
            segments: [
              { kind: 'reasoning', text: 'Because the answer is simple.' },
              { kind: 'content', text: 'OK' },
            ],
            rawResponseBody: 'data: {"choices":[{"delta":{"reasoning_content":"Because the answer is simple."}}]}\n\ndata: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n',
            chunks: [],
          }
        },
      },
      mcpGateway: {
        async initializeSession() {
          throw new Error('not used')
        },
        async listTools() {
          throw new Error('not used')
        },
        async callTool() {
          throw new Error('not used')
        },
      },
    })

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Streaming Session',
        modelProfileSnapshot: {
          id: 'model-1',
          name: 'Model',
          connectionBaseUrl: 'https://example.com/v1',
          apiKey: null,
          modelKey: 'model-key',
          modelDisplayName: 'Model Key',
          systemPrompt: 'Reply exactly.',
          temperature: 0,
          reasoning: 'on',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })
    const sessionId = sessionResponse.json().session.id as string

    const streamResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/stream`,
      payload: {
        userContent: 'Say OK.',
      },
    })
    expect(streamResponse.statusCode).toBe(200)
    const events = parseSseEvents(streamResponse.body)

    expect(events.map(event => event.event)).toEqual([
      'turn-started',
      'round-started',
      'part-delta',
      'part-delta',
      'part-committed',
      'part-committed',
      'round-committed',
      'turn-committed',
    ])
    expect(events[2]?.data.delta).toEqual({
      kind: 'reasoning',
      textDelta: 'Because the answer is simple.',
    })
    expect(events[3]?.data.delta).toEqual({
      kind: 'content',
      textDelta: 'OK',
    })
    expect(events[4]?.data.part).toEqual(expect.objectContaining({ partType: 'assistant-reasoning' }))
    expect(events[5]?.data.part).toEqual(expect.objectContaining({ partType: 'assistant-content' }))
    expect((events.at(-1)?.data.trace as { context: Array<{ type: string }> }).context.some(entry => entry.type === 'assistant-reasoning')).toBe(false)
  })

  it('streams tool-enabled turn events as deltas followed by committed parts', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config, {
      lmStudioGateway: {
        async probePromptTokensDetailed(_baseUrl, _apiKey, body) {
          const messages = body.messages as Array<{ role: string; content?: string | null }>
          const hasTools = Array.isArray(body.tools) && body.tools.length > 0
          const hasToolMessage = messages.some(message => message.role === 'assistant' && message.content == null)
          const toolResultCount = messages.filter(message => message.role === 'tool').length
          let promptTokens: number

          if (messages.length === 1 && messages[0]?.role === 'system' && !hasTools) {
            promptTokens = 4
          } else if (messages.length === 2 && messages.every(message => message.role === 'system') && !hasTools) {
            promptTokens = 9
          } else if (messages.length === 2 && messages.every(message => message.role === 'system') && hasTools) {
            promptTokens = 16
          } else if (messages.length === 3 && hasTools && !hasToolMessage) {
            promptTokens = 20
          } else if (messages.length === 4 && hasTools && hasToolMessage && toolResultCount === 0) {
            promptTokens = 24
          } else if (messages.length === 5 && hasTools && hasToolMessage && toolResultCount === 1) {
            promptTokens = 30
          } else {
            throw new Error(`Unexpected probe shape: ${JSON.stringify(body)}`)
          }

          return {
            promptTokens,
            completion: {
              id: `probe-${promptTokens}`,
              model: 'model-key',
              created: 122,
              choices: [],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: 0,
                total_tokens: promptTokens,
              },
            },
            rawExchange: {
              requestUrl: 'https://example.com/v1/chat/completions',
              requestMethod: 'POST',
              requestHeadersJson: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              requestBody: JSON.stringify(body),
              responseStatus: 200,
              responseHeadersJson: {
                'content-type': 'application/json',
              },
              responseBody: JSON.stringify({
                id: `probe-${promptTokens}`,
                usage: { prompt_tokens: promptTokens },
              }),
            },
          }
        },
        async createChatCompletion() {
          throw new Error('not used')
        },
        async streamChatCompletion(_baseUrl, _apiKey, body, callbacks) {
          const messages = body.messages as Array<{ role: string }>
          const hasToolResult = messages.some(message => message.role === 'tool')

          if (!hasToolResult) {
            callbacks?.onDelta?.({
              kind: 'reasoning',
              textDelta: 'I need the current time from the tool.',
            })
            callbacks?.onDelta?.({
              kind: 'tool-call',
              toolCallIndex: 0,
              idDelta: 'call-1',
              nameDelta: 'ha_history_get_current_time',
              argumentsDelta: '{}',
            })
            return {
              completion: {
                id: 'cmpl-tool-1',
                model: 'model-key',
                created: 123,
                choices: [
                  {
                    index: 0,
                    finish_reason: 'tool_calls',
                    message: {
                      role: 'assistant',
                      content: null,
                      reasoning_content: 'I need the current time from the tool.',
                      tool_calls: [
                        {
                          id: 'call-1',
                          type: 'function',
                          function: {
                            name: 'ha_history_get_current_time',
                            arguments: '{}',
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 20,
                  completion_tokens: 10,
                  reasoning_tokens: 4,
                  total_tokens: 30,
                },
              },
              segments: [
                { kind: 'reasoning', text: 'I need the current time from the tool.' },
                { kind: 'tool-call', toolCallIndex: 0 },
              ],
              rawResponseBody: 'data: {"choices":[{"delta":{"reasoning_content":"I need the current time from the tool."}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"ha_history_get_current_time","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n',
              chunks: [],
            }
          }

          callbacks?.onDelta?.({
            kind: 'content',
            textDelta: 'The current time is 12:34.',
          })
          return {
            completion: {
              id: 'cmpl-tool-2',
              model: 'model-key',
              created: 124,
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: 'The current time is 12:34.',
                  },
                },
              ],
              usage: {
                prompt_tokens: 30,
                completion_tokens: 8,
                reasoning_tokens: 0,
                total_tokens: 38,
              },
            },
            segments: [
              { kind: 'content', text: 'The current time is 12:34.' },
            ],
            rawResponseBody: 'data: {"choices":[{"delta":{"content":"The current time is 12:34."}}]}\n\ndata: [DONE]\n',
            chunks: [],
          }
        },
      },
      mcpGateway: {
        async initializeSession() {
          return {
            sessionId: 'mcp-session-1',
            instructions: 'Use tools accurately.',
            rawExchange: {
              requestUrl: 'http://localhost:3001/mcp',
              requestMethod: 'POST',
              requestBodyText: '{"jsonrpc":"2.0"}',
              responseStatus: 200,
              responseBody: { result: { instructions: 'Use tools accurately.' } },
            },
          }
        },
        async listTools() {
          return {
            tools: [
              {
                name: 'ha_history_get_current_time',
                description: 'Returns current time',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
            rawResult: {},
            rawExchange: {
              requestUrl: 'http://localhost:3001/mcp',
              requestMethod: 'POST',
              requestBodyText: '{"method":"tools/list"}',
              responseStatus: 200,
              responseBody: { result: { tools: ['ha_history_get_current_time'] } },
            },
          }
        },
        async callTool() {
          return {
            content: '2026-05-10T12:34:56+02:00',
            structuredContent: null,
            isError: false,
            rawResult: {},
            rawExchange: {
              requestUrl: 'http://localhost:3001/mcp',
              requestMethod: 'POST',
              requestBodyText: '{"method":"tools/call"}',
              responseStatus: 200,
              responseBody: { result: { content: [{ type: 'text', text: '2026-05-10T12:34:56+02:00' }] } },
            },
          }
        },
      },
    })

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Streaming Tool Session',
        modelProfileSnapshot: {
          id: 'model-1',
          name: 'Model',
          connectionBaseUrl: 'https://example.com/v1',
          apiKey: null,
          modelKey: 'model-key',
          modelDisplayName: 'Model Key',
          systemPrompt: 'Use tools when required.',
          temperature: 0,
          reasoning: 'on',
          createdAt: 1,
          updatedAt: 1,
        },
        mcpProfileSnapshot: {
          id: 'mcp-1',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })
    const sessionId = sessionResponse.json().session.id as string

    const streamResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/stream`,
      payload: {
        userContent: 'Use the tool to tell me the current time.',
      },
    })
    expect(streamResponse.statusCode).toBe(200)
    const events = parseSseEvents(streamResponse.body)

    expect(events.map(event => event.event)).toEqual([
      'turn-started',
      'round-started',
      'part-delta',
      'part-delta',
      'part-committed',
      'part-committed',
      'part-committed',
      'round-committed',
      'round-started',
      'part-delta',
      'part-committed',
      'round-committed',
      'turn-committed',
    ])
    expect(events[2]?.data.delta).toEqual({
      kind: 'reasoning',
      textDelta: 'I need the current time from the tool.',
    })
    expect(events[3]?.data.delta).toEqual({
      kind: 'tool-call',
      toolCallIndex: 0,
      idDelta: 'call-1',
      nameDelta: 'ha_history_get_current_time',
      argumentsDelta: '{}',
    })
    expect(events[9]?.data.delta).toEqual({
      kind: 'content',
      textDelta: 'The current time is 12:34.',
    })
    expect(events[4]?.data.part).toEqual(expect.objectContaining({ partType: 'assistant-reasoning' }))
    expect(events[5]?.data.part).toEqual(expect.objectContaining({ partType: 'tool-call' }))
    expect(events[6]?.data.part).toEqual(expect.objectContaining({ partType: 'tool-result' }))
    expect(events[10]?.data.part).toEqual(expect.objectContaining({ partType: 'assistant-content' }))
    expect((events.at(-1)?.data.trace as { context: Array<{ type: string }> }).context.some(entry => entry.type === 'assistant-reasoning')).toBe(false)
  })

  it('creates a session and completes a backend-owned model-only turn', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(
      config,
      {
          lmStudioGateway: {
            async probePromptTokens() {
              return 3
            },
            async probePromptTokensDetailed(_baseUrl, _apiKey, body) {
              return {
                promptTokens: 3,
                completion: {
                  id: 'probe-cmpl-1',
                  model: 'model-key',
                  created: 122,
                  choices: [],
                  usage: {
                    prompt_tokens: 3,
                    completion_tokens: 0,
                    total_tokens: 3,
                  },
                },
                rawExchange: {
                  requestUrl: 'https://example.com/v1/chat/completions',
                  requestMethod: 'POST',
                  requestHeadersJson: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                  },
                  requestBody: JSON.stringify(body),
                  responseStatus: 200,
                  responseHeadersJson: {
                    'content-type': 'application/json',
                  },
                  responseBody: JSON.stringify({
                    id: 'probe-cmpl-1',
                    usage: {
                      prompt_tokens: 3,
                    },
                  }),
                },
              }
            },
            async createChatCompletion() {
              return {
                id: 'cmpl-1',
              model: 'model-key',
              created: 123,
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    reasoning_content: 'Because the answer is simple.',
                    content: 'OK',
                  },
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 6,
                total_tokens: 16,
                completion_tokens_details: {
                  reasoning_tokens: 4,
                },
              },
            }
          },
        },
        mcpGateway: {
          async initializeSession() {
            throw new Error('not used')
          },
          async listTools() {
            throw new Error('not used')
          },
          async callTool() {
            throw new Error('not used')
          },
        },
      },
    )

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Integration Session',
        modelProfileSnapshot: {
          id: 'model-1',
          name: 'Model',
          connectionBaseUrl: 'https://example.com/v1',
          apiKey: null,
          modelKey: 'model-key',
          modelDisplayName: 'Model Key',
          systemPrompt: 'Reply exactly.',
          temperature: 0,
          reasoning: 'on',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })

    expect(sessionResponse.statusCode).toBe(201)
    const createdSessionId = sessionResponse.json().session.id as string

    const turnResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${createdSessionId}/turns`,
      payload: {
        userContent: 'Say OK.',
      },
    })

    expect(turnResponse.statusCode).toBe(201)
    const turnBody = turnResponse.json()
    expect(turnBody.turn.status).toBe('complete')
    expect(turnBody.round.status).toBe('complete')
    expect(turnBody.parts.map((part: { partType: string }) => part.partType)).toEqual([
      'user-message',
      'assistant-reasoning',
      'assistant-content',
    ])

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${createdSessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    const traceBody = traceResponse.json()
    expect(traceBody.transcript).toHaveLength(3)
    expect(traceBody.context.map((entry: { type: string }) => entry.type)).toEqual([
      'system-prompt',
      'user-message',
      'assistant-content',
    ])
    expect(traceBody.turns).toHaveLength(1)
    expect(traceBody.rounds).toHaveLength(1)
    expect(traceBody.rawExchanges.map((exchange: { kind: string }) => exchange.kind)).toEqual(
      expect.arrayContaining([
        'lmstudio-probe-request',
        'lmstudio-probe-response',
        'lmstudio-request',
        'lmstudio-response',
      ]),
    )
  })

  it('completes a tool-enabled turn through the backend route', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(
      config,
      {
          lmStudioGateway: {
            async probePromptTokens(_baseUrl, _apiKey, body) {
            const messages = body.messages as Array<{ role: string; content?: string | null }>
            const hasTools = Array.isArray(body.tools) && body.tools.length > 0
            const hasToolMessage = messages.some(message => message.role === 'assistant' && message.content == null)
            const toolResultCount = messages.filter(message => message.role === 'tool').length

            if (messages.length === 1 && messages[0]?.role === 'system' && !hasTools) {
              return 4
            }
            if (messages.length === 2 && messages.every(message => message.role === 'system') && !hasTools) {
              return 9
            }
            if (messages.length === 2 && messages.every(message => message.role === 'system') && hasTools) {
              return 16
            }
            if (messages.length === 3 && hasTools && !hasToolMessage) {
              return 20
            }
            if (messages.length === 4 && hasTools && hasToolMessage && toolResultCount === 0) {
              return 24
            }
            if (messages.length === 5 && hasTools && hasToolMessage && toolResultCount === 1) {
              return 30
            }

              throw new Error(`Unexpected probe shape: ${JSON.stringify(body)}`)
            },
            async probePromptTokensDetailed(_baseUrl, _apiKey, body) {
              const messages = body.messages as Array<{ role: string; content?: string | null }>
              const hasTools = Array.isArray(body.tools) && body.tools.length > 0
              const hasToolMessage = messages.some(message => message.role === 'assistant' && message.content == null)
              const toolResultCount = messages.filter(message => message.role === 'tool').length
              let promptTokens: number

              if (messages.length === 1 && messages[0]?.role === 'system' && !hasTools) {
                promptTokens = 4
              } else if (messages.length === 2 && messages.every(message => message.role === 'system') && !hasTools) {
                promptTokens = 9
              } else if (messages.length === 2 && messages.every(message => message.role === 'system') && hasTools) {
                promptTokens = 16
              } else if (messages.length === 3 && hasTools && !hasToolMessage) {
                promptTokens = 20
              } else if (messages.length === 4 && hasTools && hasToolMessage && toolResultCount === 0) {
                promptTokens = 24
              } else if (messages.length === 5 && hasTools && hasToolMessage && toolResultCount === 1) {
                promptTokens = 30
              } else {
                throw new Error(`Unexpected probe shape: ${JSON.stringify(body)}`)
              }

              return {
                promptTokens,
                completion: {
                  id: `probe-${promptTokens}`,
                  model: 'model-key',
                  created: 122,
                  choices: [],
                  usage: {
                    prompt_tokens: promptTokens,
                    completion_tokens: 0,
                    total_tokens: promptTokens,
                  },
                },
                rawExchange: {
                  requestUrl: 'https://example.com/v1/chat/completions',
                  requestMethod: 'POST',
                  requestHeadersJson: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                  },
                  requestBody: JSON.stringify(body),
                  responseStatus: 200,
                  responseHeadersJson: {
                    'content-type': 'application/json',
                  },
                  responseBody: JSON.stringify({
                    id: `probe-${promptTokens}`,
                    usage: {
                      prompt_tokens: promptTokens,
                    },
                  }),
                },
              }
            },
            async createChatCompletion(_baseUrl, _apiKey, body) {
            const messages = body.messages as Array<{ role: string }>
            const hasToolResult = messages.some(message => message.role === 'tool')

            if (!hasToolResult) {
              return {
                id: 'cmpl-tool-1',
                model: 'model-key',
                created: 123,
                choices: [
                  {
                    index: 0,
                    finish_reason: 'tool_calls',
                    message: {
                      role: 'assistant',
                      content: null,
                      reasoning_content: 'I need the current time from the tool.',
                      tool_calls: [
                        {
                          id: 'call-1',
                          type: 'function',
                          function: {
                            name: 'ha_history_get_current_time',
                            arguments: '{}',
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 20,
                  completion_tokens: 10,
                  reasoning_tokens: 4,
                  total_tokens: 30,
                },
              }
            }

            return {
              id: 'cmpl-tool-2',
              model: 'model-key',
              created: 124,
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: 'The current time is 12:34.',
                  },
                },
              ],
              usage: {
                prompt_tokens: 30,
                completion_tokens: 8,
                reasoning_tokens: 0,
                total_tokens: 38,
              },
            }
          },
        },
        mcpGateway: {
          async initializeSession() {
            return {
              sessionId: 'mcp-session-1',
              instructions: 'Use tools accurately.',
              rawExchange: {
                requestUrl: 'http://localhost:3001/mcp',
                requestMethod: 'POST',
                requestBodyText: '{"jsonrpc":"2.0"}',
                responseStatus: 200,
                responseBody: { result: { instructions: 'Use tools accurately.' } },
              },
            }
          },
          async listTools() {
            return {
              tools: [
                {
                  name: 'ha_history_get_current_time',
                  description: 'Returns current time',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
              rawResult: {},
              rawExchange: {
                requestUrl: 'http://localhost:3001/mcp',
                requestMethod: 'POST',
                requestBodyText: '{"method":"tools/list"}',
                responseStatus: 200,
                responseBody: { result: { tools: ['ha_history_get_current_time'] } },
              },
            }
          },
          async callTool() {
            return {
              content: '2026-05-10T12:34:56+02:00',
              structuredContent: null,
              isError: false,
              rawResult: {},
              rawExchange: {
                requestUrl: 'http://localhost:3001/mcp',
                requestMethod: 'POST',
                requestBodyText: '{"method":"tools/call"}',
                responseStatus: 200,
                responseBody: { result: { content: [{ type: 'text', text: '2026-05-10T12:34:56+02:00' }] } },
              },
            }
          },
        },
      },
    )

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Tool session',
        modelProfileSnapshot: {
          id: 'model-1',
          name: 'Model',
          connectionBaseUrl: 'https://example.com/v1',
          apiKey: null,
          modelKey: 'model-key',
          modelDisplayName: 'Model Key',
          systemPrompt: 'Use tools when required.',
          temperature: 0,
          reasoning: 'on',
          createdAt: 1,
          updatedAt: 1,
        },
        mcpProfileSnapshot: {
          id: 'mcp-1',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })

    const sessionId = sessionResponse.json().session.id as string
    const turnResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        userContent: 'Use the tool to tell me the current time.',
      },
    })

    expect(turnResponse.statusCode).toBe(201)
    const body = turnResponse.json()
    expect(body.turn.status).toBe('complete')
    expect(body.turn.outcome).toBe('tool-assisted-response')
    expect(body.rounds).toHaveLength(2)
    expect(body.parts.map((part: { partType: string }) => part.partType)).toEqual([
      'user-message',
      'assistant-reasoning',
      'tool-call',
      'tool-result',
      'assistant-content',
    ])
    expect(body.parts[0].tokens.count).toBeTypeOf('number')
    expect(body.parts[2].tokens.count).toBeTypeOf('number')
    expect(body.parts[3].tokens.count).toBeTypeOf('number')

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    const traceBody = traceResponse.json()
    expect(
      traceBody.context.filter((entry: { type: string }) => (
        entry.type === 'system-prompt'
        || entry.type === 'mcp-instructions'
        || entry.type === 'tool-definitions'
      )),
    ).toEqual([
      expect.objectContaining({ type: 'system-prompt', tokens: expect.objectContaining({ count: 4 }) }),
      expect.objectContaining({ type: 'mcp-instructions', tokens: expect.objectContaining({ count: 5 }) }),
      expect.objectContaining({ type: 'tool-definitions', tokens: expect.objectContaining({ count: 7 }) }),
    ])
    expect(traceBody.turns).toHaveLength(1)
    expect(traceBody.rounds).toHaveLength(2)
    expect(traceBody.rawExchanges.map((exchange: { kind: string }) => exchange.kind)).toEqual(
      expect.arrayContaining([
        'lmstudio-request',
        'lmstudio-response',
        'mcp-request',
        'mcp-response',
      ]),
    )
  })
})

describe('error handling contract', () => {
  let app: FastifyInstance | undefined
  let dataDir: string | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true })
      dataDir = undefined
    }
  })

  it('returns structured { error: { type, message } } on 404', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/does-not-exist/trace',
    })

    expect(response.statusCode).toBe(404)
    const body = response.json()
    expect(body).toMatchObject({ error: { type: 'not_found', message: expect.any(String) } })
  })

  it('returns 503 with upstream error shape when MCP test endpoint cannot connect', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp-profiles/test',
      payload: { url: 'http://127.0.0.1:9/mcp' },
    })

    expect(response.statusCode).toBe(503)
    const body = response.json()
    expect(body).toMatchObject({ error: { type: 'upstream', message: expect.any(String) } })
  })

  it('returns 503 with lm_studio_unreachable code when preflight cannot reach LM Studio', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/preflight',
      payload: {
        lmConnectionSnapshot: { baseUrl: 'http://127.0.0.1:9/v1', apiKey: null },
        mcpProfileSnapshot: null,
        selectedModel: { modelKey: 'qwen3.6-35b-a3b-apex' },
      },
    })

    expect(response.statusCode).toBe(503)
    const body = response.json()
    expect(body).toMatchObject({
      error: { type: 'upstream', code: 'lm_studio_unreachable', message: expect.any(String) },
    })
  })

  it('returns 409 with lm_model_not_loaded when preflight selected model is not loaded', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config)

    const lmServer = createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'loaded-model' }] }))
        return
      }

      if (req.url === '/api/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            models: [
              {
                type: 'llm',
                key: 'loaded-model',
                loaded_instances: [{ config: { context_length: 8192 } }],
              },
              {
                type: 'llm',
                key: 'unloaded-model',
                loaded_instances: [],
              },
            ],
          }),
        )
        return
      }

      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{}')
    })

    await new Promise<void>((resolve, reject) => {
      lmServer.once('error', reject)
      lmServer.listen(0, '127.0.0.1', () => resolve())
    })

    try {
      const port = (lmServer.address() as AddressInfo).port
      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/preflight',
        payload: {
          lmConnectionSnapshot: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: null },
          mcpProfileSnapshot: null,
          selectedModel: { modelKey: 'unloaded-model', modelDisplayName: 'Unloaded Model' },
        },
      })

      expect(response.statusCode).toBe(409)
      const body = response.json()
      expect(body).toMatchObject({
        error: {
          type: 'validation',
          code: 'lm_model_not_loaded',
          message: expect.stringContaining('not loaded'),
        },
      })
    } finally {
      await new Promise<void>((resolve) => lmServer.close(() => resolve()))
    }
  })

  it('emits turn-failed SSE event with errorType when streaming gateway throws', async () => {
    const config = makeTestConfig()
    dataDir = config.dataDir
    app = await buildBackendApp(config, {
      lmStudioGateway: {
        async probePromptTokensDetailed(_baseUrl, _apiKey, body) {
          return {
            promptTokens: 3,
            completion: {
              id: 'probe-1', model: 'model-key', created: 1, choices: [],
              usage: { prompt_tokens: 3, completion_tokens: 0, total_tokens: 3 },
            },
            rawExchange: {
              requestUrl: 'https://example.com/v1/chat/completions',
              requestMethod: 'POST',
              requestHeadersJson: { 'Content-Type': 'application/json' },
              requestBody: JSON.stringify(body),
              responseStatus: 200,
              responseHeadersJson: { 'content-type': 'application/json' },
              responseBody: '{}',
            },
          }
        },
        async createChatCompletion() { throw new Error('not used') },
        async streamChatCompletion() { throw new Error('LM Studio connection lost') },
      },
      mcpGateway: {
        async initializeSession() { throw new Error('not used') },
        async listTools() { throw new Error('not used') },
        async callTool() { throw new Error('not used') },
      },
    })

    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Error test session',
        modelProfileSnapshot: {
          id: 'model-1', name: 'Model', connectionBaseUrl: 'https://example.com/v1',
          apiKey: null, modelKey: 'model-key', modelDisplayName: 'Model Key',
          systemPrompt: 'You are helpful.', temperature: 0, reasoning: null,
          createdAt: 1, updatedAt: 1,
        },
      },
    })
    const sessionId = sessionRes.json().session.id as string

    const streamRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/stream`,
      payload: { userContent: 'Hello' },
    })

    const events = parseSseEvents(streamRes.body)
    const failedEvent = events.find(e => e.event === 'turn-failed')
    expect(failedEvent).toBeDefined()
    expect(failedEvent!.data).toMatchObject({
      type: 'turn-failed',
      errorType: expect.any(String),
      message: expect.any(String),
    })
  })
})
