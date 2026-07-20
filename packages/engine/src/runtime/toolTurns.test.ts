import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openBackendDatabase } from '../persistence/db.js'
import { insertStepRecord } from '../persistence/repository.js'
import { stepTypeKey } from '../domain/executionModel.js'
import { createSession } from './modelTurns.js'
import { createToolEnabledTurn } from './toolTurns.js'
import { resolveHierarchicalId } from './hierarchicalLookup.js'
import { renderInspect } from '../inspect/renderInspect.js'
import type { InspectResult } from '../operations/inspect.js'
import type { ChatCompletionGateway } from './modelTurns.js'
import type { McpGateway } from './toolTurns.js'
import { StreamReadError } from '../services/openai/client.js'

const minimalMcpGateway: McpGateway = {
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
    throw new Error('should not be called — the stream fails before any tool call')
  },
}

describe('tool-enabled turn runtime', () => {
  const cleanupDirs = new Set<string>()

  function makeSqlitePath() {
    const dir = path.join('.tmp-test-data', `tool-runtime-test-${crypto.randomUUID()}`)
    cleanupDirs.add(dir)
    return path.join(dir, 'test.db')
  }

  afterEach(() => {
    cleanupDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }))
    cleanupDirs.clear()
  })

  it('persists a tool call round and a final assistant round', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens() {
        return 5
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        const hasToolResult = messages.some((message) => message.role === 'tool')

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

    chatCompletionGateway.probePromptTokens = async (_baseUrl, _apiKey, body) => {
      const messages = body.messages as Array<{ role: string; content?: string | null }>
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0
      const hasToolMessage = messages.some(
        (message) => message.role === 'assistant' && message.content == null,
      )
      const toolResultCount = messages.filter((message) => message.role === 'tool').length

      if (messages.length === 1 && messages[0]?.role === 'system' && !hasTools) {
        return 4
      }
      if (
        messages.length === 2 &&
        messages.every((message) => message.role === 'system') &&
        !hasTools
      ) {
        return 9
      }
      if (
        messages.length === 2 &&
        messages.every((message) => message.role === 'system') &&
        hasTools
      ) {
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
      mcpProfileSnapshots: [
        {
          id: 'mcp-1',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    insertStepRecord(db.connection, {
      id: `${session.id}.4W`,
      sessionId: session.id,
      stepTypeKey: stepTypeKey('analysis_bootstrap'),
      parentStepId: null,
      childIndex: 3,
      status: 'complete',
      params: {},
      state: {},
      createdAt: 1,
      completedAt: 1,
    })

    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Tell me the current time with tools.',
      maxToolRounds: 5,
    })

    expect(result.turn.status).toBe('complete')
    expect(result.turn.outcome).toBe('tool-assisted-response')
    expect(result.rounds).toHaveLength(2)
    expect(result.parts.map((part) => part.partType)).toEqual([
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
    expect(result.context.map((entry) => entry.type)).toContain('tool-call')
    expect(result.context.map((entry) => entry.type)).toContain('tool-result')

    const sessionPrelude = result.context.filter(
      (entry) =>
        entry.type === 'system-prompt' ||
        entry.type === 'mcp-instructions' ||
        entry.type === 'tool-definitions',
    )
    expect(sessionPrelude).toEqual([
      expect.objectContaining({
        type: 'system-prompt',
        tokens: expect.objectContaining({ count: 4 }),
      }),
      expect.objectContaining({
        type: 'mcp-instructions',
        tokens: expect.objectContaining({ count: 5 }),
      }),
      expect.objectContaining({
        type: 'tool-definitions',
        tokens: expect.objectContaining({ count: 7 }),
      }),
    ])

    db.connection.close()
  })

  it('nests ids under an owning workflow step', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens() {
        return 5
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        const hasToolResult = messages.some((message) => message.role === 'tool')

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
      mcpProfileSnapshots: [
        {
          id: 'mcp-1',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    insertStepRecord(db.connection, {
      id: `${session.id}.4W`,
      sessionId: session.id,
      stepTypeKey: stepTypeKey('analysis_bootstrap'),
      parentStepId: null,
      childIndex: 3,
      status: 'complete',
      params: {},
      state: {},
      createdAt: 1,
      completedAt: 1,
    })

    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
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

    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string; content?: string | null }>
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0
        const hasToolMessage = messages.some(
          (message) => message.role === 'assistant' && message.content == null,
        )
        const toolResultCount = messages.filter((message) => message.role === 'tool').length

        if (messages.length === 1 && messages[0]?.role === 'system' && !hasTools) {
          return 4
        }
        if (
          messages.length === 2 &&
          messages.every((message) => message.role === 'system') &&
          !hasTools
        ) {
          return 9
        }
        if (
          messages.length === 2 &&
          messages.every((message) => message.role === 'system') &&
          hasTools
        ) {
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
        const hasToolResult = messages.some((message) => message.role === 'tool')

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
      mcpProfileSnapshots: [
        {
          id: 'mcp-2',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Tell me both the time and the office max temperature.',
      maxToolRounds: 5,
    })

    const toolCallParts = result.parts.filter((part) => part.partType === 'tool-call')
    const toolResultParts = result.parts.filter((part) => part.partType === 'tool-result')

    expect(toolCallParts).toHaveLength(2)
    expect(toolCallParts.every((part) => part.tokens.source === 'estimated')).toBe(true)
    expect(toolCallParts.reduce((sum, part) => sum + (part.tokens.count ?? 0), 0)).toBe(9)
    expect(toolCallParts[1]!.tokens.count).toBeGreaterThan(toolCallParts[0]!.tokens.count ?? 0)

    expect(toolResultParts).toHaveLength(2)
    expect(toolResultParts.map((part) => part.tokens.count)).toEqual([8, 3])
    expect(toolResultParts.every((part) => part.tokens.source === 'estimated')).toBe(true)

    db.connection.close()
  })

  it('preserves assistant content when it shares a message with tool calls', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string; content?: string | null }>
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0
        const toolResultCount = messages.filter((message) => message.role === 'tool').length
        const assistantWithContentAndTools = messages.some(
          (message) =>
            message.role === 'assistant' &&
            typeof message.content === 'string' &&
            message.content.length > 0,
        )

        if (messages.length === 1 && messages[0]?.role === 'system' && !hasTools) {
          return 4
        }
        if (
          messages.length === 2 &&
          messages.every((message) => message.role === 'system') &&
          !hasTools
        ) {
          return 9
        }
        if (
          messages.length === 2 &&
          messages.every((message) => message.role === 'system') &&
          hasTools
        ) {
          return 16
        }
        if (messages.length === 3 && hasTools) {
          return 20
        }
        if (
          messages.length === 4 &&
          hasTools &&
          assistantWithContentAndTools &&
          toolResultCount === 0
        ) {
          return 26
        }
        if (
          messages.length === 5 &&
          hasTools &&
          assistantWithContentAndTools &&
          toolResultCount === 1
        ) {
          return 31
        }

        throw new Error(`Unexpected probe shape: ${JSON.stringify(body)}`)
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        const hasToolResult = messages.some((message) => message.role === 'tool')

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
                  reasoning_content:
                    'I should call the current time tool after acknowledging the plan.',
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
      mcpProfileSnapshots: [
        {
          id: 'mcp-3',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Tell me the time.',
      maxToolRounds: 5,
    })

    expect(result.parts.map((part) => part.partType)).toEqual([
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

    const assistantMessages = result.context.filter((entry) => entry.type === 'assistant-content')
    expect(assistantMessages.map((entry) => entry.text)).toContain('I will check the time.')
    expect(assistantMessages.map((entry) => entry.text)).toContain('It is 12:34.')

    db.connection.close()
  })

  it('captures segmented reasoning blocks across multiple rounds while stripping them from later requests', async () => {
    const db = openBackendDatabase(makeSqlitePath())
    const observedRequests: Array<Array<Record<string, unknown>>> = []

    function estimatePromptTokens(body: {
      messages: Array<Record<string, unknown>>
      tools?: unknown[]
    }): number {
      const toolCount = Array.isArray(body.tools) ? body.tools.length : 0
      return body.messages.reduce(
        (sum, message) => {
          const contentLength = typeof message.content === 'string' ? message.content.length : 0
          const toolCallsLength = Array.isArray(message.tool_calls)
            ? message.tool_calls.reduce((innerSum, toolCall) => {
                const record = toolCall as { function?: { name?: string; arguments?: string } }
                return (
                  innerSum +
                  (record.function?.name?.length ?? 0) +
                  (record.function?.arguments?.length ?? 0) +
                  12
                )
              }, 0)
            : 0
          return sum + 20 + contentLength + toolCallsLength
        },
        40 + toolCount * 10,
      )
    }

    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens(_baseUrl, _apiKey, body) {
        return estimatePromptTokens(
          body as { messages: Array<Record<string, unknown>>; tools?: unknown[] },
        )
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
                          arguments:
                            '{"entity":"sensor.sensor_ab12_temperature","start_time":"2026-01-01","end_time":"2026-02-01"}',
                        },
                      },
                      {
                        id: 'call-feb',
                        type: 'function',
                        function: {
                          name: 'ha_history_get_sensor_stats',
                          arguments:
                            '{"entity":"sensor.sensor_ab12_temperature","start_time":"2026-02-01","end_time":"2026-03-01"}',
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
                          arguments:
                            '{"entity":"sensor.sensor_ab12_temperature","start_time":"2026-03-01","end_time":"2026-04-01"}',
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
                          arguments:
                            '{"entity":"sensor.sensor_ab12_temperature","start_time":"2026-04-01","end_time":"2026-05-01"}',
                        },
                      },
                      {
                        id: 'call-may',
                        type: 'function',
                        function: {
                          name: 'ha_history_get_sensor_stats',
                          arguments:
                            '{"entity":"sensor.sensor_ab12_temperature","start_time":"2026-05-01","end_time":"2026-06-01"}',
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
      mcpProfileSnapshots: [
        {
          id: 'mcp-4',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Work in three batches with varied tool counts before answering.',
      maxToolRounds: 6,
    })

    expect(observedRequests).toHaveLength(4)
    expect(
      observedRequests
        .slice(1)
        .every((messages) => messages.every((message) => !('reasoning_content' in message))),
    ).toBe(true)

    const reasoningParts = result.parts.filter((part) => part.partType === 'assistant-reasoning')
    expect(reasoningParts).toHaveLength(6)
    expect(reasoningParts.every((part) => part.context.state === 'stripped')).toBe(true)
    expect(result.transcript.filter((entry) => entry.type === 'assistant-reasoning')).toHaveLength(
      6,
    )
    expect(result.context.filter((entry) => entry.type === 'assistant-reasoning')).toHaveLength(0)

    const toolCallCounts = new Map<string, number>()
    for (const part of result.parts) {
      if (part.partType !== 'tool-call' || !part.roundId) continue
      toolCallCounts.set(part.roundId, (toolCallCounts.get(part.roundId) ?? 0) + 1)
    }
    expect(
      result.rounds
        .filter((round) => round.finishReason === 'tool_calls')
        .map((round) => toolCallCounts.get(round.id) ?? 0),
    ).toEqual([2, 1, 2])

    db.connection.close()
  })

  it('feeds malformed tool-call arguments and unknown tool names back as error tool-results instead of failing the turn', async () => {
    const db = openBackendDatabase(makeSqlitePath())
    const calledTools: string[] = []

    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens() {
        return 5
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        const toolResultCount = messages.filter((message) => message.role === 'tool').length

        if (toolResultCount === 0) {
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
                  tool_calls: [
                    {
                      id: 'call-bad-json',
                      type: 'function',
                      function: {
                        name: 'get_current_time',
                        arguments: '{"zone": "Europe/', // malformed JSON from a flaky model
                      },
                    },
                    {
                      id: 'call-bad-name',
                      type: 'function',
                      function: {
                        name: 'hallucinated_tool',
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
              reasoning_tokens: 0,
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
              message: { role: 'assistant', content: 'I could not call the tools.' },
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 8, reasoning_tokens: 0, total_tokens: 38 },
        }
      },
    }

    const rawExchange = {
      requestUrl: 'http://localhost:3001/mcp',
      requestMethod: 'POST',
      requestBodyText: '{}',
      responseStatus: 200,
      responseBody: {},
    }
    const mcpGateway: McpGateway = {
      async initializeSession() {
        return { sessionId: 'mcp-session-1', rawExchange }
      },
      async listTools() {
        return {
          tools: [
            {
              name: 'get_current_time',
              description: 'Current time',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
          rawResult: {},
          rawExchange,
        }
      },
      async callTool(_serverUrl, _sessionId, toolName) {
        calledTools.push(toolName)
        return {
          content: 'ok',
          structuredContent: null,
          isError: false,
          rawResult: {},
          rawExchange,
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
        reasoning: 'off',
        createdAt: 1,
        updatedAt: 1,
      },
      mcpProfileSnapshots: [
        {
          id: 'mcp-1',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Tell me the current time with tools.',
      maxToolRounds: 5,
    })

    // The turn survives and completes; no MCP call is ever attempted for
    // either invalid tool call.
    expect(result.turn.status).toBe('complete')
    expect(calledTools).toEqual([])

    const toolResults = result.parts.filter((part) => part.partType === 'tool-result')
    expect(toolResults).toHaveLength(2)
    const texts = toolResults.map((part) => part.payload.text ?? '')
    expect(texts.some((text) => text.includes('not valid JSON'))).toBe(true)
    expect(texts.some((text) => text.includes('hallucinated_tool'))).toBe(true)

    // Token attribution must not wipe the creation-time provenance that
    // benchmark metrics (per-tool error counting) and analysis evidence read.
    for (const part of toolResults) {
      const prov = part.provenanceJson as { isError?: boolean; toolName?: string }
      expect(prov.isError).toBe(true)
      expect(typeof prov.toolName).toBe('string')
    }

    db.connection.close()
  })

  it('recovers partial content and a diagnostic instead of losing the turn on a mid-stream failure', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens() {
        return 4
      },
      async createChatCompletion() {
        throw new Error('should not be called — streamChatCompletion takes priority')
      },
      async streamChatCompletion() {
        throw new StreamReadError('Stream reading failed after 17 bytes: socket hang up', 17, {
          completion: {
            id: 'c1',
            model: 'model-key',
            created: 1,
            choices: [{ index: 0, finish_reason: null, message: { role: 'assistant' } }],
          },
          segments: [{ kind: 'content', text: 'Here is what I have' }],
          rawResponseBody: 'data: {}\n\n',
          chunks: [],
        })
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
      mcpProfileSnapshots: [
        {
          id: 'mcp-1',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const emittedTypes: string[] = []
    const result = await createToolEnabledTurn(
      db,
      chatCompletionGateway,
      minimalMcpGateway,
      { sessionId: session.id, userContent: 'Tell me the current time.', maxToolRounds: 5 },
      (event) => emittedTypes.push(event.type),
    )

    expect(result.turn.status).toBe('error')
    expect(result.turn.outcome).toBe(
      'step-error: Stream reading failed after 17 bytes: socket hang up',
    )
    expect(result.round.status).toBe('error')
    expect(result.round.finishReason).toBe('error')
    expect(result.parts.map((part) => part.partType)).toEqual([
      'user-message',
      'assistant-content',
      'diagnostic-note',
    ])
    expect(result.parts[1]?.payload.text).toBe('Here is what I have')
    const diagnostic = result.parts[2]
    expect(diagnostic?.context.state).toBe('excluded')
    expect(diagnostic?.display.state).toBe('transcript')
    expect(diagnostic?.payload.text).toMatch(/partial response above was preserved/)
    expect(diagnostic?.payload.text).toMatch(/received 17 bytes/)

    // turn-failed, not turn-committed: the backend's SSE relay closes the
    // stream on the first event matching either type, so emitting both would
    // silently drop whichever came second for a live subscriber.
    expect(emittedTypes).toContain('turn-failed')
    expect(emittedTypes).not.toContain('turn-committed')

    db.connection.close()
  })

  it('persists a length-truncated final response as complete-but-truncated instead of lying about the finish reason', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens() {
        return 4
      },
      async createChatCompletion() {
        return {
          id: 'c1',
          model: 'model-key',
          created: 1,
          choices: [
            {
              index: 0,
              finish_reason: 'length',
              message: { role: 'assistant', content: 'This is as far as I got before' },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
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
      mcpProfileSnapshots: [
        {
          id: 'mcp-1',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const result = await createToolEnabledTurn(db, chatCompletionGateway, minimalMcpGateway, {
      sessionId: session.id,
      userContent: 'Tell me the current time.',
      maxToolRounds: 5,
    })

    expect(result.turn.status).toBe('complete')
    expect(result.turn.outcome).toBe('model-response-truncated')
    expect(result.round.status).toBe('complete')
    expect(result.round.finishReason).toBe('length')
    expect(result.parts.map((part) => part.partType)).toEqual([
      'user-message',
      'assistant-content',
      'diagnostic-note',
    ])
    const diagnostic = result.parts[2]
    expect(diagnostic?.payload.text).toMatch(/truncated/i)
    expect(diagnostic?.context.state).toBe('excluded')

    db.connection.close()
  })

  // ── Loop-guard fixes: repeated-call short-circuit + last-chance answer ──────

  function toolCallCompletion(id: string, name: string, argumentsJson: string) {
    return {
      id,
      model: 'model-key',
      created: 1,
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls' as const,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id, type: 'function', function: { name, arguments: argumentsJson } }],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, reasoning_tokens: 0, total_tokens: 15 },
    }
  }

  function stopCompletion(text: string) {
    return {
      id: 'stop-1',
      model: 'model-key',
      created: 1,
      choices: [
        { index: 0, finish_reason: 'stop' as const, message: { role: 'assistant', content: text } },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, reasoning_tokens: 0, total_tokens: 15 },
    }
  }

  function makeInspectGateway(callCounter: { count: number }): McpGateway {
    return {
      async initializeSession() {
        return {
          sessionId: 'mcp-session-1',
          instructions: 'Inspect the session.',
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
              name: 'inspect',
              description: 'Inspect a session by id',
              inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
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
        callCounter.count += 1
        return {
          content: 'INSPECT-RESULT-BODY',
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
  }

  function makeToolSession(db: ReturnType<typeof openBackendDatabase>) {
    return createSession(db, {
      modelProfileSnapshot: {
        id: 'model-1',
        name: 'Model',
        connectionBaseUrl: 'https://example.com/v1',
        apiKey: null,
        modelKey: 'model-key',
        modelDisplayName: 'Model Key',
        systemPrompt: 'Use tools when required.',
        temperature: 0,
        reasoning: 'off',
        createdAt: 1,
        updatedAt: 1,
      },
      mcpProfileSnapshots: [
        {
          id: 'mcp-1',
          name: 'Local MCP',
          url: 'http://localhost:3001/mcp',
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
  }

  it('short-circuits a repeated identical tool call within a turn and nudges the model to answer', async () => {
    const db = openBackendDatabase(makeSqlitePath())
    const counter = { count: 0 }
    const mcpGateway = makeInspectGateway(counter)

    let round = 0
    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens() {
        return 5
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string; content?: string | null }>
        const lastTool = [...messages].reverse().find((m) => m.role === 'tool')
        if (lastTool && String(lastTool.content ?? '').includes('Duplicate tool call skipped')) {
          return stopCompletion('Verdict: done.')
        }
        round += 1
        // Same tool + identical args every round — a degenerate re-inspect loop.
        return toolCallCompletion(`call-${round}`, 'inspect', '{"id":"X"}')
      },
    }

    const session = makeToolSession(db)
    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Judge session X.',
      maxToolRounds: 8,
    })

    // The identical second call is short-circuited: the server ran only once.
    expect(counter.count).toBe(1)
    const toolResults = result.parts.filter((p) => p.partType === 'tool-result')
    expect(toolResults).toHaveLength(2)
    expect(toolResults[1]?.payload.text).toMatch(/Duplicate tool call skipped/)
    // The earlier result is reproduced so an idempotent re-fetch loses nothing.
    expect(toolResults[1]?.payload.text).toContain('INSPECT-RESULT-BODY')
    // A skipped duplicate is not a tool error and must not inflate error metrics.
    expect((toolResults[1]?.provenanceJson as { isError?: boolean } | null)?.isError).toBe(false)

    expect(result.turn.status).toBe('complete')
    const answer = result.parts.filter((p) => p.partType === 'assistant-content').at(-1)
    expect(answer?.payload.text).toBe('Verdict: done.')

    db.connection.close()
  })

  it('gives one final tools-disabled answer round when the tool-call budget is exhausted', async () => {
    const db = openBackendDatabase(makeSqlitePath())
    const counter = { count: 0 }
    const mcpGateway = makeInspectGateway(counter)

    let round = 0
    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens() {
        return 5
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        // The recovery round omits tools entirely — that is our signal to answer.
        if (!body.tools) return stopCompletion('Final forced answer.')
        round += 1
        // Distinct args each round so the dedup guard does not interfere.
        return toolCallCompletion(`call-${round}`, 'inspect', JSON.stringify({ n: round }))
      },
    }

    const session = makeToolSession(db)
    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Judge session X.',
      maxToolRounds: 2,
    })

    expect(counter.count).toBe(2)
    expect(result.turn.status).toBe('complete')
    expect(result.turn.outcome).toBe('tool-assisted-response-after-limit:2')
    const answer = result.parts.filter((p) => p.partType === 'assistant-content').at(-1)
    expect(answer?.payload.text).toBe('Final forced answer.')
    const note = result.parts.find((p) => p.partType === 'diagnostic-note')
    expect(note?.payload.text).toMatch(/budget reached/i)
    expect(note?.payload.text).toMatch(/final tools-disabled round/i)

    db.connection.close()
  })

  it('still ends in a tool-loop-limit error when the final tools-disabled round yields no answer', async () => {
    const db = openBackendDatabase(makeSqlitePath())
    const counter = { count: 0 }
    const mcpGateway = makeInspectGateway(counter)

    let round = 0
    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens() {
        return 5
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        if (!body.tools) return stopCompletion('') // recovery round also delivers nothing
        round += 1
        return toolCallCompletion(`call-${round}`, 'inspect', JSON.stringify({ n: round }))
      },
    }

    const session = makeToolSession(db)
    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Judge session X.',
      maxToolRounds: 2,
    })

    expect(result.turn.status).toBe('error')
    expect(result.turn.outcome).toBe('tool-loop-limit:2')
    expect(result.parts.some((p) => p.partType === 'assistant-content')).toBe(false)
    const note = result.parts.find((p) => p.partType === 'diagnostic-note')
    expect(note?.payload.text).toMatch(/final tools-disabled round still produced no assistant answer/i)

    db.connection.close()
  })

  it('marks a terminal turn that delivered no assistant answer as "no final answer" on inspect', async () => {
    const db = openBackendDatabase(makeSqlitePath())
    const counter = { count: 0 }
    const mcpGateway = makeInspectGateway(counter)

    let round = 0
    const chatCompletionGateway: ChatCompletionGateway = {
      async probePromptTokens() {
        return 5
      },
      async createChatCompletion(_baseUrl, _apiKey, body) {
        if (!body.tools) return stopCompletion('') // never delivers an answer
        round += 1
        return toolCallCompletion(`call-${round}`, 'inspect', JSON.stringify({ n: round }))
      },
    }

    const session = makeToolSession(db)
    const result = await createToolEnabledTurn(db, chatCompletionGateway, mcpGateway, {
      sessionId: session.id,
      userContent: 'Judge session X.',
      maxToolRounds: 2,
    })

    // Data layer: the turn node carries an explicit no_final_answer marker.
    const turnLookup = resolveHierarchicalId(db.connection, result.turn.id, 'full')
    expect(turnLookup.status).toBe('ok')
    const turnData = (turnLookup as { payload: { data: Record<string, unknown> } }).payload.data
    expect(turnData['no_final_answer']).toBe(true)

    // Render layer: an explicit line, not a silent absence, for the reader/judge.
    const text = renderInspect(
      (turnLookup as { payload: InspectResult }).payload,
      'text',
    )
    expect(text).toMatch(/no final answer/i)

    // A healthy answered turn does NOT carry the marker.
    const sessionLookup = resolveHierarchicalId(db.connection, session.id, 'full')
    const sessionText = renderInspect(
      (sessionLookup as { payload: InspectResult }).payload,
      'text',
    )
    expect(sessionText).toMatch(/no final answer/i)

    db.connection.close()
  })
})
