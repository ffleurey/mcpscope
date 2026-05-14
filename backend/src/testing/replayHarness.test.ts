import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBackendApp } from '../app.js'
import type { SessionTraceBundle } from './replayHarness.js'
import { expectTraceToReplay } from './replayHarness.js'

function makeSqlitePath() {
  return path.join('.tmp-test-data', `replay-fixture-${crypto.randomUUID()}`, 'test.db')
}

async function captureTraceFixture(input: {
  sessionPayload: Record<string, unknown>
  turnInputs: string[]
  dependencies: Parameters<typeof buildBackendApp>[1]
}): Promise<SessionTraceBundle> {
  const sqlitePath = makeSqlitePath()
  const app = await buildBackendApp(
    {
      host: '127.0.0.1',
      port: 3030,
      corsOrigin: true,
      dataDir: path.dirname(sqlitePath),
      sqlitePath,
      maxToolRounds: 5,
    },
    input.dependencies,
  )

  try {
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: input.sessionPayload,
    })
    expect(sessionResponse.statusCode).toBe(201)
    const sessionId = sessionResponse.json().session.id as string

    for (const userContent of input.turnInputs) {
      const turnResponse = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/turns`,
        payload: {
          userContent,
        },
      })
      expect(turnResponse.statusCode).toBe(201)
    }

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    return traceResponse.json() as SessionTraceBundle
  } finally {
    await app.close()
    fs.rmSync(path.dirname(sqlitePath), { recursive: true, force: true })
  }
}

describe('session trace replay harness', () => {
  it('replays a deterministic model-only trace bundle', async () => {
    const trace = await captureTraceFixture({
      sessionPayload: {
        title: 'Replay model-only fixture',
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
      turnInputs: ['Say OK.'],
      dependencies: {
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
    })

    await expectTraceToReplay(trace)
  })

  it('replays a deterministic tool-enabled trace bundle', async () => {
    const trace = await captureTraceFixture({
      sessionPayload: {
        title: 'Replay tool fixture',
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
      turnInputs: ['Use the tool to tell me the current time.'],
      dependencies: {
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
                requestHeaders: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json, text/event-stream',
                },
                requestBodyText: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 1,
                  method: 'initialize',
                  params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: {
                      name: 'mcpscope-backend-tests',
                      version: '0.1.0',
                    },
                  },
                }),
                responseStatus: 200,
                responseHeaders: {
                  'content-type': 'application/json',
                  'mcp-session-id': 'mcp-session-1',
                },
                responseBodyText: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 1,
                  result: {
                    instructions: 'Use tools accurately.',
                  },
                }),
                responseBody: {
                  jsonrpc: '2.0',
                  id: 1,
                  result: { instructions: 'Use tools accurately.' },
                },
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
                requestHeaders: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json, text/event-stream',
                  'mcp-session-id': 'mcp-session-1',
                },
                requestBodyText: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 2,
                  method: 'tools/list',
                  params: {},
                }),
                responseStatus: 200,
                responseHeaders: {
                  'content-type': 'application/json',
                },
                responseBodyText: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 2,
                  result: {
                    tools: [
                      {
                        name: 'ha_history_get_current_time',
                        description: 'Returns current time',
                        inputSchema: { type: 'object', properties: {} },
                      },
                    ],
                  },
                }),
                responseBody: {
                  jsonrpc: '2.0',
                  id: 2,
                  result: {
                    tools: [
                      {
                        name: 'ha_history_get_current_time',
                        description: 'Returns current time',
                        inputSchema: { type: 'object', properties: {} },
                      },
                    ],
                  },
                },
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
                requestHeaders: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json, text/event-stream',
                  'mcp-session-id': 'mcp-session-1',
                },
                requestBodyText: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 3,
                  method: 'tools/call',
                  params: {
                    name: 'ha_history_get_current_time',
                    arguments: {},
                  },
                }),
                responseStatus: 200,
                responseHeaders: {
                  'content-type': 'application/json',
                },
                responseBodyText: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 3,
                  result: {
                    content: [{ type: 'text', text: '2026-05-10T12:34:56+02:00' }],
                  },
                }),
                responseBody: {
                  jsonrpc: '2.0',
                  id: 3,
                  result: { content: [{ type: 'text', text: '2026-05-10T12:34:56+02:00' }] },
                },
              },
            }
          },
        },
      },
    })

    await expectTraceToReplay(trace)
  })
})
