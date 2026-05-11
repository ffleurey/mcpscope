import fs from 'node:fs'
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
      service: 'ai-clientapp-backend',
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
      sqlite_schema_version: '2',
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

    const transcriptResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${createdSessionId}/transcript`,
    })
    expect(transcriptResponse.statusCode).toBe(200)
    expect(transcriptResponse.json().transcript).toHaveLength(3)

    const contextResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${createdSessionId}/context`,
    })
    expect(contextResponse.statusCode).toBe(200)
    expect(contextResponse.json().context.map((entry: { type: string }) => entry.type)).toEqual([
      'system-prompt',
      'user-message',
      'assistant-content',
    ])

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${createdSessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    expect(traceResponse.json().turns).toHaveLength(1)
    expect(traceResponse.json().rounds).toHaveLength(1)
    expect(traceResponse.json().rawExchanges.map((exchange: { kind: string }) => exchange.kind)).toEqual(
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

    const contextResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/context`,
    })
    expect(contextResponse.statusCode).toBe(200)
    expect(
      contextResponse.json().context.filter((entry: { type: string }) => (
        entry.type === 'system-prompt'
        || entry.type === 'mcp-instructions'
        || entry.type === 'tool-definitions'
      )),
    ).toEqual([
      expect.objectContaining({ type: 'system-prompt', tokens: expect.objectContaining({ count: 4 }) }),
      expect.objectContaining({ type: 'mcp-instructions', tokens: expect.objectContaining({ count: 5 }) }),
      expect.objectContaining({ type: 'tool-definitions', tokens: expect.objectContaining({ count: 7 }) }),
    ])

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    expect(traceResponse.json().turns).toHaveLength(1)
    expect(traceResponse.json().rounds).toHaveLength(2)
    expect(traceResponse.json().rawExchanges.map((exchange: { kind: string }) => exchange.kind)).toEqual(
      expect.arrayContaining([
        'lmstudio-request',
        'lmstudio-response',
        'mcp-request',
        'mcp-response',
      ]),
    )
  })
})
