import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildBackendApp } from './app.js'

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
      sqlite_schema_version: '1',
    })
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
