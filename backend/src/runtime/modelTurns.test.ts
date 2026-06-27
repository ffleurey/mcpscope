import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSession, createModelOnlyTurn, sessionTemperatureBody } from './modelTurns.js'
import { openBackendDatabase } from '../persistence/db.js'
import { insertStepRecord } from '../persistence/repository.js'
import { stepTypeKey } from '../domain/executionModel.js'
import type { ChatCompletionGateway } from './modelTurns.js'

describe('model-only turn runtime', () => {
  const cleanupDirs = new Set<string>()

  function makeSqlitePath() {
    const dir = path.join('.tmp-test-data', `runtime-test-${crypto.randomUUID()}`)
    cleanupDirs.add(dir)
    return path.join(dir, 'test.db')
  }

  afterEach(() => {
    cleanupDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }))
    cleanupDirs.clear()
  })

  it('creates a session and persists a complete model-only turn with reasoning and content parts', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    let completionCallCount = 0
    const gateway: ChatCompletionGateway = {
      async probePromptTokens(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        if (messages.length === 1 && messages[0]?.role === 'system') {
          return 4
        }
        if (
          messages.length === 3
          && messages[0]?.role === 'system'
          && messages[1]?.role === 'user'
          && messages[2]?.role === 'assistant'
        ) {
          return 9
        }

        throw new Error(`Unexpected probe shape: ${JSON.stringify(body)}`)
      },
      async createChatCompletion() {
        completionCallCount += 1
        if (completionCallCount === 1) {
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
                  reasoning_content: 'I should answer briefly.',
                  content: 'OK',
                },
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 7,
              total_tokens: 19,
              completion_tokens_details: {
                reasoning_tokens: 5,
              },
            },
          }
        }

        return {
          id: 'cmpl-2',
          model: 'model-key',
          created: 124,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                reasoning_content: 'I should answer the follow-up briefly.',
                content: 'Done',
              },
            },
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 6,
            total_tokens: 21,
            completion_tokens_details: {
              reasoning_tokens: 2,
            },
          },
        }
      },
    }

    const session = createSession(db, {
      modelProfileSnapshot: {
        id: 'model-1',
        name: 'Model',
        connectionBaseUrl: 'https://example.com/v1',
        apiKey: 'secret',
        modelKey: 'model-key',
        modelDisplayName: 'Model Key',
        systemPrompt: 'Reply exactly.',
        temperature: 0,
        reasoning: 'on',
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

    const result = await createModelOnlyTurn(db, gateway, {
      sessionId: session.id,
      userContent: 'Say OK.',
    })

    expect(result.turn.status).toBe('complete')
    expect(result.round.status).toBe('complete')
    expect(result.turn.usage).toEqual({
      promptTokens: 12,
      completionTokens: 7,
      reasoningTokens: 5,
      totalTokens: 19,
    })

    expect(result.parts.map(part => part.partType)).toEqual([
      'user-message',
      'assistant-reasoning',
      'assistant-content',
    ])
    expect(result.parts[0]?.tokens).toMatchObject({
      count: 8,
      source: 'delta-derived',
      confidence: 'exact',
    })
    expect(result.parts[1]?.tokens.count).toBe(5)
    expect(result.parts[2]?.tokens.count).toBe(2)
    expect(result.session.systemPromptTokens).toBe(4)
    expect(result.transcript.map(entry => entry.type)).toEqual([
      'user-message',
      'assistant-reasoning',
      'assistant-content',
    ])
    expect(result.context.map(entry => entry.type).sort()).toEqual([
      'assistant-content',
      'system-prompt',
      'user-message',
    ])

    const secondTurn = await createModelOnlyTurn(db, gateway, {
      sessionId: session.id,
      userContent: 'And now say Done.',
    })

    expect(secondTurn.turn.turnNumber).toBe(2)
    expect(secondTurn.turn.usage).toEqual({
      promptTokens: 15,
      completionTokens: 6,
      reasoningTokens: 2,
      totalTokens: 21,
    })
    expect(secondTurn.parts.map(part => part.partType)).toEqual([
      'user-message',
      'assistant-reasoning',
      'assistant-content',
    ])
    expect(secondTurn.parts[0]?.tokens).toMatchObject({
      count: 6,
      source: 'delta-derived',
      confidence: 'exact',
    })

    db.connection.close()
  })

  it('nests ids under an owning workflow step', async () => {
    const db = openBackendDatabase(makeSqlitePath())

    const gateway: ChatCompletionGateway = {
      async probePromptTokens(_baseUrl, _apiKey, body) {
        const messages = body.messages as Array<{ role: string }>
        if (messages.length === 1 && messages[0]?.role === 'system') return 4
        if (messages.length === 3) return 9
        throw new Error(`Unexpected probe shape: ${JSON.stringify(body)}`)
      },
      async createChatCompletion() {
        return {
          id: 'cmpl-owner-step',
          model: 'model-key',
          created: 125,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                reasoning_content: 'Done.',
                content: 'OK',
              },
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 7,
            total_tokens: 19,
            completion_tokens_details: {
              reasoning_tokens: 5,
            },
          },
        }
      },
    }

    const session = createSession(db, {
      modelProfileSnapshot: {
        id: 'model-1',
        name: 'Model',
        connectionBaseUrl: 'https://example.com/v1',
        apiKey: 'secret',
        modelKey: 'model-key',
        modelDisplayName: 'Model Key',
        systemPrompt: 'Reply exactly.',
        temperature: 0,
        reasoning: 'on',
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

    const result = await createModelOnlyTurn(db, gateway, {
      sessionId: session.id,
      userContent: 'Say OK.',
      ownerStepId: `${session.id}.4W`,
    })

    expect(result.turn.id).toBe(`${session.id}.4W.1T`)
    expect(result.round.id).toBe(`${session.id}.4W.1T.1`)
    expect(result.parts[0]?.id).toBe(`${session.id}.4W.1T.1.1-U`)

    db.connection.close()
  })
})

describe('sessionTemperatureBody', () => {
  // The snapshot is the only field read; cast a minimal stub for this pure fn.
  function withTemperature(temperature: number | null | undefined) {
    return { modelProfileSnapshot: { temperature } } as unknown as Parameters<
      typeof sessionTemperatureBody
    >[0]
  }

  it('omits temperature when unset (null or undefined) so the provider default is used', () => {
    expect(sessionTemperatureBody(withTemperature(null))).toEqual({})
    expect(sessionTemperatureBody(withTemperature(undefined))).toEqual({})
  })

  it('includes 0 — a valid deterministic temperature, not an "unset" sentinel', () => {
    expect(sessionTemperatureBody(withTemperature(0))).toEqual({ temperature: 0 })
  })

  it('includes a configured temperature', () => {
    expect(sessionTemperatureBody(withTemperature(0.7))).toEqual({ temperature: 0.7 })
  })
})
