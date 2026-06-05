import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openBackendDatabase } from '../persistence/db.js'
import { insertStepRecord } from '../persistence/repositoryV2.js'
import { stepTypeKey } from '../domain/executionModel.js'
import { createSession } from './modelTurns.js'
import { createToolEnabledTurn } from './toolTurns.js'
import type { LmStudioGateway } from './modelTurns.js'
import type { McpGateway } from './toolTurns.js'

describe('tool-enabled turn runtime', () => {
  const cleanupDirs = new Set<string>()

  function makeSqlitePath() {
    const dir = path.join('.tmp-test-data', `tool-runtime-test-${crypto.randomUUID()}`)
    cleanupDirs.add(dir)
    return path.join(dir, 'test.db')
  }

  afterEach(() => {
    cleanupDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }))
    cleanupDirs.clear()
  })

  it('persists a tool call round and a final assistant round', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const lmStudioGateway: LmStudioGateway = {
      async probePromptTokens() {
        return 5
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        const hasToolResult = messages.some(message => message.role === 'tool')

        if (!hasToolResult) {
          return {
            id: 'cmpl-1',
            model: 'model-key',
            created: 100,
            choices: [
              {
                index: 0,
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  reasoning_content: 'I should call the current time tool.',
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
          id: 'cmpl-2',
          model: 'model-key',
          created: 101,
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
    }

    lmStudioGateway.probePromptTokens = async (_baseUrl, _apiKey, body) => {
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
    }

    const mcpGateway: McpGateway = {
      async initializeSession() {
        return {
          sessionId: 'mcp-session-1',
          instructions: 'Use the time tool.',
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
      async listTools() {
        return {
          tools: [
            {
              name: 'ha_history_get_current_time',
              description: 'Current time',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
          rawResult: {},
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
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
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
    }

    const session = createSession(db, {
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
    })

    insertStepRecord(db.connection, {
      id: `${session.id}.4W`,
      sessionId: session.id,
      stepTypeKey: stepTypeKey('analysis_v2_cursor'),
      parentStepId: null,
      childIndex: 3,
      status: 'complete',
      params: {},
      state: {},
      createdAt: 1,
      completedAt: 1,
    })

    const result = await createToolEnabledTurn(db, lmStudioGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Tell me the current time with tools.',
      maxToolRounds: 5,
    })

    expect(result.turn.status).toBe('complete')
    expect(result.turn.outcome).toBe('tool-assisted-response')
    expect(result.rounds).toHaveLength(2)
    expect(result.parts.map(part => part.partType)).toEqual([
      'user-message',
      'assistant-reasoning',
      'tool-call',
      'tool-result',
      'assistant-content',
    ])
    expect(result.parts[0]?.tokens).toMatchObject({
      count: 4,
      source: 'delta-derived',
      confidence: 'exact',
    })
    expect(result.parts[2]?.tokens).toMatchObject({
      count: 6,
      source: 'exact-api',
      confidence: 'estimated',
    })
    expect(result.parts[3]?.tokens).toMatchObject({
      count: 4,
      source: 'estimated',
      confidence: 'estimated',
    })
    expect(result.context.map(entry => entry.type)).toContain('tool-call')
    expect(result.context.map(entry => entry.type)).toContain('tool-result')

    const sessionPrelude = result.context.filter(entry => (
      entry.type === 'system-prompt'
      || entry.type === 'mcp-instructions'
      || entry.type === 'tool-definitions'
    ))
    expect(sessionPrelude).toEqual([
      expect.objectContaining({ type: 'system-prompt', tokens: expect.objectContaining({ count: 4 }) }),
      expect.objectContaining({ type: 'mcp-instructions', tokens: expect.objectContaining({ count: 5 }) }),
      expect.objectContaining({ type: 'tool-definitions', tokens: expect.objectContaining({ count: 7 }) }),
    ])

    db.connection.close()
  })

  it('nests ids under an owning workflow step', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const lmStudioGateway: LmStudioGateway = {
      async probePromptTokens() {
        return 5
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        const hasToolResult = messages.some(message => message.role === 'tool')

        if (!hasToolResult) {
          return {
            id: 'cmpl-1',
            model: 'model-key',
            created: 100,
            choices: [
              {
                index: 0,
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  reasoning_content: 'Call tool.',
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
          id: 'cmpl-2',
          model: 'model-key',
          created: 101,
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
    }

    const mcpGateway: McpGateway = {
      async initializeSession() {
        return {
          sessionId: 'mcp-session-1',
          instructions: 'Use the time tool.',
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
      async listTools() {
        return {
          tools: [
            {
              name: 'ha_history_get_current_time',
              description: 'Current time',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
          rawResult: {},
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
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
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
    }

    const session = createSession(db, {
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
    })

    insertStepRecord(db.connection, {
      id: `${session.id}.4W`,
      sessionId: session.id,
      stepTypeKey: stepTypeKey('analysis_v2_cursor'),
      parentStepId: null,
      childIndex: 3,
      status: 'complete',
      params: {},
      state: {},
      createdAt: 1,
      completedAt: 1,
    })

    const result = await createToolEnabledTurn(db, lmStudioGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Tell me the current time with tools.',
      maxToolRounds: 5,
      ownerStepId: `${session.id}.4W`,
    })

    expect(result.turn.id).toBe(`${session.id}.4W.1T`)
    expect(result.rounds[0]?.id).toBe(`${session.id}.4W.1T.1`)
    expect(result.parts[0]?.id).toBe(`${session.id}.4W.1T.1.1-U`)

    db.connection.close()
  })

  it('allocates grouped tool-call prompt tokens proportionally across multiple tool calls', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const lmStudioGateway: LmStudioGateway = {
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
          return 28
        }
        if (messages.length === 5 && hasTools && hasToolMessage && toolResultCount === 1) {
          return 33
        }
        if (messages.length === 6 && hasTools && hasToolMessage && toolResultCount === 2) {
          return 40
        }

        throw new Error(`Unexpected probe shape: ${JSON.stringify(body)}`)
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        const hasToolResult = messages.some(message => message.role === 'tool')

        if (!hasToolResult) {
          return {
            id: 'cmpl-multi-1',
            model: 'model-key',
            created: 200,
            choices: [
              {
                index: 0,
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  reasoning_content: 'I should call both tools.',
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: {
                        name: 'ha_history_get_current_time',
                        arguments: '{}',
                      },
                    },
                    {
                      id: 'call-2',
                      type: 'function',
                      function: {
                        name: 'ha_history_get_sensor_stats',
                        arguments: '{"entity":"sensor.office_temperature","aggregation":"max"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 12,
              reasoning_tokens: 3,
              total_tokens: 32,
            },
          }
        }

        return {
          id: 'cmpl-multi-2',
          model: 'model-key',
          created: 201,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'It is 12:34 and the office max was 23 C.',
              },
            },
          ],
          usage: {
            prompt_tokens: 40,
            completion_tokens: 9,
            reasoning_tokens: 0,
            total_tokens: 49,
          },
        }
      },
    }

    let toolCallCount = 0
    const mcpGateway: McpGateway = {
      async initializeSession() {
        return {
          sessionId: 'mcp-session-2',
          instructions: 'Use the time and stats tools.',
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
      async listTools() {
        return {
          tools: [
            {
              name: 'ha_history_get_current_time',
              description: 'Current time',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'ha_history_get_sensor_stats',
              description: 'Sensor stats',
              inputSchema: {
                type: 'object',
                properties: {
                  entity: { type: 'string' },
                  aggregation: { type: 'string' },
                },
              },
            },
          ],
          rawResult: {},
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
      async callTool() {
        toolCallCount += 1
        return {
          content: toolCallCount === 1 ? '2026-05-10T12:34:56+02:00' : 'Max: 23 C',
          structuredContent: null,
          isError: false,
          rawResult: {},
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
    }

    const session = createSession(db, {
      modelProfileSnapshot: {
        id: 'model-2',
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
        id: 'mcp-2',
        name: 'Local MCP',
        url: 'http://localhost:3001/mcp',
        transport: 'streamable-http',
        authType: null,
        authValue: null,
        createdAt: 1,
        updatedAt: 1,
      },
    })

    const result = await createToolEnabledTurn(db, lmStudioGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Tell me both the time and the office max temperature.',
      maxToolRounds: 5,
    })

    const toolCallParts = result.parts.filter(part => part.partType === 'tool-call')
    const toolResultParts = result.parts.filter(part => part.partType === 'tool-result')

    expect(toolCallParts).toHaveLength(2)
    expect(toolCallParts.every(part => part.tokens.source === 'estimated')).toBe(true)
    expect(toolCallParts.reduce((sum, part) => sum + (part.tokens.count ?? 0), 0)).toBe(9)
    expect(toolCallParts[1]!.tokens.count).toBeGreaterThan(toolCallParts[0]!.tokens.count ?? 0)

    expect(toolResultParts).toHaveLength(2)
    expect(toolResultParts.map(part => part.tokens.count)).toEqual([8, 3])
    expect(toolResultParts.every(part => part.tokens.source === 'estimated')).toBe(true)

    db.connection.close()
  })

  it('preserves assistant content when it shares a message with tool calls', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const lmStudioGateway: LmStudioGateway = {
      async probePromptTokens(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string; content?: string | null }>
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0
        const toolResultCount = messages.filter(message => message.role === 'tool').length
        const assistantWithContentAndTools = messages.some(message => (
          message.role === 'assistant'
          && typeof message.content === 'string'
          && message.content.length > 0
        ))

        if (messages.length === 1 && messages[0]?.role === 'system' && !hasTools) {
          return 4
        }
        if (messages.length === 2 && messages.every(message => message.role === 'system') && !hasTools) {
          return 9
        }
        if (messages.length === 2 && messages.every(message => message.role === 'system') && hasTools) {
          return 16
        }
        if (messages.length === 3 && hasTools) {
          return 20
        }
        if (messages.length === 4 && hasTools && assistantWithContentAndTools && toolResultCount === 0) {
          return 26
        }
        if (messages.length === 5 && hasTools && assistantWithContentAndTools && toolResultCount === 1) {
          return 31
        }

        throw new Error(`Unexpected probe shape: ${JSON.stringify(body)}`)
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        const hasToolResult = messages.some(message => message.role === 'tool')

        if (!hasToolResult) {
          return {
            id: 'cmpl-mixed-1',
            model: 'model-key',
            created: 300,
            choices: [
              {
                index: 0,
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: 'I will check the time.',
                  reasoning_content: 'I should call the current time tool after acknowledging the plan.',
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
              completion_tokens: 11,
              reasoning_tokens: 3,
              total_tokens: 31,
            },
          }
        }

        return {
          id: 'cmpl-mixed-2',
          model: 'model-key',
          created: 301,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'It is 12:34.',
              },
            },
          ],
          usage: {
            prompt_tokens: 31,
            completion_tokens: 7,
            reasoning_tokens: 0,
            total_tokens: 38,
          },
        }
      },
    }

    const mcpGateway: McpGateway = {
      async initializeSession() {
        return {
          sessionId: 'mcp-session-3',
          instructions: 'Use the time tool.',
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
      async listTools() {
        return {
          tools: [
            {
              name: 'ha_history_get_current_time',
              description: 'Current time',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
          rawResult: {},
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
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
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
    }

    const session = createSession(db, {
      modelProfileSnapshot: {
        id: 'model-3',
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
        id: 'mcp-3',
        name: 'Local MCP',
        url: 'http://localhost:3001/mcp',
        transport: 'streamable-http',
        authType: null,
        authValue: null,
        createdAt: 1,
        updatedAt: 1,
      },
    })

    const result = await createToolEnabledTurn(db, lmStudioGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Tell me the time.',
      maxToolRounds: 5,
    })

    expect(result.parts.map(part => part.partType)).toEqual([
      'user-message',
      'assistant-reasoning',
      'assistant-content',
      'tool-call',
      'tool-result',
      'assistant-content',
    ])

    const mixedAssistantContent = result.parts[2]
    const toolCallPart = result.parts[3]
    const toolResultPart = result.parts[4]

    expect(mixedAssistantContent?.payload.text).toBe('I will check the time.')
    expect(mixedAssistantContent?.tokens).toMatchObject({
      count: 2,
      source: 'estimated',
      confidence: 'estimated',
    })
    expect(toolCallPart?.tokens).toMatchObject({
      count: 6,
      source: 'estimated',
      confidence: 'estimated',
    })
    expect(toolResultPart?.tokens).toMatchObject({
      count: 3,
      source: 'estimated',
      confidence: 'estimated',
    })

    const assistantMessages = result.context.filter(entry => entry.type === 'assistant-content')
    expect(assistantMessages.map(entry => entry.text)).toContain('I will check the time.')
    expect(assistantMessages.map(entry => entry.text)).toContain('It is 12:34.')

    db.connection.close()
  })

  it('captures segmented reasoning blocks across multiple rounds while stripping them from later requests', async () => {
    const db = openBackendDatabase(makeSqlitePath())
    const observedRequests: Array<Array<Record<string, unknown>>> = []

    function estimatePromptTokens(body: { messages: Array<Record<string, unknown>>; tools?: unknown[] }): number {
      const toolCount = Array.isArray(body.tools) ? body.tools.length : 0
      return body.messages.reduce((sum, message) => {
        const contentLength = typeof message.content === 'string' ? message.content.length : 0
        const toolCallsLength = Array.isArray(message.tool_calls)
          ? message.tool_calls.reduce((innerSum, toolCall) => {
              const record = toolCall as { function?: { name?: string; arguments?: string } }
              return innerSum + (record.function?.name?.length ?? 0) + (record.function?.arguments?.length ?? 0) + 12
            }, 0)
          : 0
        return sum + 20 + contentLength + toolCallsLength
      }, 40 + (toolCount * 10))
    }

    const lmStudioGateway: LmStudioGateway = {
      async probePromptTokens(_baseUrl, _apiKey, body) {
        return estimatePromptTokens(body as { messages: Array<Record<string, unknown>>; tools?: unknown[] })
      },
      async createChatCompletion() {
        throw new Error('streaming gateway should be used')
      },
      async streamChatCompletion(_baseUrl, _apiKey, body) {
        const requestBody = body as { messages: Array<Record<string, unknown>>; tools?: unknown[] }
        observedRequests.push(structuredClone(requestBody.messages))
        const promptTokens = estimatePromptTokens(requestBody)
        const roundIndex = observedRequests.length - 1

        if (roundIndex === 0) {
          return {
            completion: {
              id: 'cmpl-batch-1',
              model: 'model-key',
              created: 400,
              choices: [
                {
                  index: 0,
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        id: 'call-jan',
                        type: 'function',
                        function: {
                          name: 'ha_history_get_sensor_stats',
                          arguments: '{"entity":"sensor.ruuvitag_fc8f_temperature","start_time":"2026-01-01","end_time":"2026-02-01"}',
                        },
                      },
                      {
                        id: 'call-feb',
                        type: 'function',
                        function: {
                          name: 'ha_history_get_sensor_stats',
                          arguments: '{"entity":"sensor.ruuvitag_fc8f_temperature","start_time":"2026-02-01","end_time":"2026-03-01"}',
                        },
                      },
                    ],
                  },
                },
              ],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: 60,
                reasoning_tokens: 30,
                total_tokens: promptTokens + 60,
              },
            },
            segments: [
              { kind: 'reasoning', text: 'Plan January first.' },
              { kind: 'tool-call', toolCallIndex: 0 },
              { kind: 'reasoning', text: 'Now plan February.' },
              { kind: 'tool-call', toolCallIndex: 1 },
            ],
            rawResponseBody: 'data: batch-1\n\ndata: [DONE]\n',
            chunks: [],
          }
        }

        if (roundIndex === 1) {
          return {
            completion: {
              id: 'cmpl-batch-2',
              model: 'model-key',
              created: 401,
              choices: [
                {
                  index: 0,
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        id: 'call-mar',
                        type: 'function',
                        function: {
                          name: 'ha_history_get_sensor_stats',
                          arguments: '{"entity":"sensor.ruuvitag_fc8f_temperature","start_time":"2026-03-01","end_time":"2026-04-01"}',
                        },
                      },
                    ],
                  },
                },
              ],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: 40,
                reasoning_tokens: 18,
                total_tokens: promptTokens + 40,
              },
            },
            segments: [
              { kind: 'reasoning', text: 'March needs one follow-up query.' },
              { kind: 'tool-call', toolCallIndex: 0 },
            ],
            rawResponseBody: 'data: batch-2\n\ndata: [DONE]\n',
            chunks: [],
          }
        }

        if (roundIndex === 2) {
          return {
            completion: {
              id: 'cmpl-batch-3',
              model: 'model-key',
              created: 402,
              choices: [
                {
                  index: 0,
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        id: 'call-apr',
                        type: 'function',
                        function: {
                          name: 'ha_history_get_sensor_stats',
                          arguments: '{"entity":"sensor.ruuvitag_fc8f_temperature","start_time":"2026-04-01","end_time":"2026-05-01"}',
                        },
                      },
                      {
                        id: 'call-may',
                        type: 'function',
                        function: {
                          name: 'ha_history_get_sensor_stats',
                          arguments: '{"entity":"sensor.ruuvitag_fc8f_temperature","start_time":"2026-05-01","end_time":"2026-06-01"}',
                        },
                      },
                    ],
                  },
                },
              ],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: 54,
                reasoning_tokens: 24,
                total_tokens: promptTokens + 54,
              },
            },
            segments: [
              { kind: 'reasoning', text: 'April first.' },
              { kind: 'tool-call', toolCallIndex: 0 },
              { kind: 'reasoning', text: 'Then May.' },
              { kind: 'tool-call', toolCallIndex: 1 },
            ],
            rawResponseBody: 'data: batch-3\n\ndata: [DONE]\n',
            chunks: [],
          }
        }

        return {
          completion: {
            id: 'cmpl-final',
            model: 'model-key',
            created: 499,
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: 'All batches are complete.',
                },
              },
            ],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: 32,
              reasoning_tokens: 12,
              total_tokens: promptTokens + 32,
            },
          },
          segments: [
            { kind: 'reasoning', text: 'Summarize the collected results.' },
            { kind: 'content', text: 'All batches are complete.' },
          ],
          rawResponseBody: 'data: final\n\ndata: [DONE]\n',
          chunks: [],
        }
      },
    }

    let toolCallCount = 0
    const mcpGateway: McpGateway = {
      async initializeSession() {
        return {
          sessionId: 'mcp-session-4',
          instructions: 'Use the stats tool.',
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
      async listTools() {
        return {
          tools: [
            {
              name: 'ha_history_get_sensor_stats',
              description: 'Sensor stats',
              inputSchema: {
                type: 'object',
                properties: {
                  entity: { type: 'string' },
                  aggregation: { type: 'string' },
                  interval: { type: 'string' },
                  filter_operator: { type: 'string' },
                  filter_value: { type: 'number' },
                  start_time: { type: 'string' },
                  end_time: { type: 'string' },
                },
              },
            },
          ],
          rawResult: {},
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: '{}',
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
      async callTool(_url, _sessionId, _name, args) {
        toolCallCount += 1
        return {
          content: `Count result ${toolCallCount} for ${(args.start_time as string) ?? 'unknown'} -> ${(args.end_time as string) ?? 'unknown'}`,
          structuredContent: null,
          isError: false,
          rawResult: {},
          rawExchange: {
            requestUrl: 'http://localhost:3001/mcp',
            requestMethod: 'POST',
            requestBodyText: JSON.stringify(args),
            responseStatus: 200,
            responseBody: {},
          },
        }
      },
    }

    const session = createSession(db, {
      modelProfileSnapshot: {
        id: 'model-4',
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
        id: 'mcp-4',
        name: 'Local MCP',
        url: 'http://localhost:3001/mcp',
        transport: 'streamable-http',
        authType: null,
        authValue: null,
        createdAt: 1,
        updatedAt: 1,
      },
    })

    const result = await createToolEnabledTurn(db, lmStudioGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Work in three batches with varied tool counts before answering.',
      maxToolRounds: 6,
    })

    expect(observedRequests).toHaveLength(4)
    expect(
      observedRequests.slice(1).every(messages => messages.every(message => !('reasoning_content' in message))),
    ).toBe(true)

    const reasoningParts = result.parts.filter(part => part.partType === 'assistant-reasoning')
    expect(reasoningParts).toHaveLength(6)
    expect(reasoningParts.every(part => part.context.state === 'stripped')).toBe(true)
    expect(result.transcript.filter(entry => entry.type === 'assistant-reasoning')).toHaveLength(6)
    expect(result.context.filter(entry => entry.type === 'assistant-reasoning')).toHaveLength(0)

    const toolCallCounts = new Map<string, number>()
    for (const part of result.parts) {
      if (part.partType !== 'tool-call' || !part.roundId) continue
      toolCallCounts.set(part.roundId, (toolCallCounts.get(part.roundId) ?? 0) + 1)
    }
    expect(
      result.rounds
        .filter(round => round.finishReason === 'tool_calls')
        .map(round => toolCallCounts.get(round.id) ?? 0),
    ).toEqual([2, 1, 2])

    db.connection.close()
  })
})
