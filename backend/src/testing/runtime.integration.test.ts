import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildBackendApp } from '../app.js'
import { getIntegrationEnv } from './integrationEnv.js'
import { writeIntegrationArtifact } from './artifacts.js'

function promptBearingParts(parts: Array<{ partType: string; tokens?: { count: number | null } }>) {
  return parts.filter(part => (
    part.partType === 'user-message'
    || part.partType === 'tool-call'
    || part.partType === 'tool-result'
  ))
}

function maxToolCallsPerRound(parts: Array<{ partType: string; roundId: string | null }>): number {
  const counts = new Map<string, number>()
  for (const part of parts) {
    if (part.partType !== 'tool-call' || !part.roundId) continue
    counts.set(part.roundId, (counts.get(part.roundId) ?? 0) + 1)
  }
  return Math.max(0, ...counts.values())
}

describe('backend runtime integration', () => {
  let app: FastifyInstance | undefined
  const sqlitePath = path.join('.tmp-test-data', 'runtime-integration.db')

  afterEach(async () => {
    await app?.close()
    app = undefined
    fs.rmSync('.tmp-test-data', { recursive: true, force: true })
  })

  it('creates a session and completes a model-only backend turn against LM Studio', async () => {
    const env = getIntegrationEnv()

    app = await buildBackendApp({
      host: '127.0.0.1',
      port: 3030,
      corsOrigin: true,
      dataDir: '.tmp-test-data',
      sqlitePath,
      maxToolRounds: 5,
    })

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Live model-only integration',
        modelProfileSnapshot: {
          id: 'integration-model',
          name: 'Integration Model',
          connectionBaseUrl: env.lmStudioBaseUrl,
          apiKey: env.lmStudioApiKey,
          modelKey: env.lmStudioModel,
          modelDisplayName: env.lmStudioModel,
          systemPrompt: 'Reply with the exact text OK.',
          temperature: 0,
          reasoning: 'on',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })

    expect(sessionResponse.statusCode).toBe(201)
    writeIntegrationArtifact('runtime-create-session', sessionResponse.json())

    const sessionId = sessionResponse.json().session.id as string

    const turnResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        userContent: 'Return only OK.',
      },
    })

    expect(turnResponse.statusCode).toBe(201)
    const turnBody = turnResponse.json()
    writeIntegrationArtifact('runtime-model-only-turn', turnBody)

    expect(turnBody.turn.status).toBe('complete')
    expect(turnBody.round.status).toBe('complete')
    expect(turnBody.turn.usage.promptTokens).toBeTypeOf('number')
    expect(turnBody.turn.usage.completionTokens).toBeTypeOf('number')
    expect(turnBody.turn.usage.totalTokens).toBeTypeOf('number')
    expect(turnBody.turn.usage.totalTokens).toBe(
      turnBody.turn.usage.promptTokens + turnBody.turn.usage.completionTokens
    )

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    const traceBody = traceResponse.json()
    writeIntegrationArtifact('runtime-trace', traceBody)

    const transcript = traceBody.transcript as Array<{ type: string; text: string | null }>
    expect(transcript[0]?.type).toBe('user-message')
    expect(transcript.at(-1)?.type).toBe('assistant-content')
    expect((transcript.at(-1)?.text ?? '').trim().length).toBeGreaterThan(0)

    const context = traceBody.context as Array<{ type: string }>
    expect(context.map(entry => entry.type)).toContain('user-message')
    expect(context.map(entry => entry.type)).toContain('assistant-content')
    expect(
      context.find(entry => entry.type === 'system-prompt'),
    ).toEqual(
      expect.objectContaining({
        type: 'system-prompt',
        tokens: expect.objectContaining({
          count: expect.any(Number),
        }),
      }),
    )
  }, 120_000)

  it('completes a tool-enabled backend turn against LM Studio and the local MCP server', async () => {
    const env = getIntegrationEnv()

    app = await buildBackendApp({
      host: '127.0.0.1',
      port: 3030,
      corsOrigin: true,
      dataDir: '.tmp-test-data',
      sqlitePath,
      maxToolRounds: 5,
    })

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Live tool integration',
        modelProfileSnapshot: {
          id: 'integration-model-tools',
          name: 'Integration Model Tools',
          connectionBaseUrl: env.lmStudioBaseUrl,
          apiKey: env.lmStudioApiKey,
          modelKey: env.lmStudioModel,
          modelDisplayName: env.lmStudioModel,
          systemPrompt: 'Use the available tools when they can answer directly. If a time tool exists, use it for current-time questions.',
          temperature: 0,
          reasoning: 'on',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        mcpProfileSnapshots: [{
          id: 'integration-mcp',
          name: 'Local MCP',
          url: env.mcpServerUrl,
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      },
    })

    expect(sessionResponse.statusCode).toBe(201)
    const sessionId = sessionResponse.json().session.id as string

    const turnResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        userContent: 'Use the available tool to tell me the current time in Oslo.',
      },
    })

    expect(turnResponse.statusCode).toBe(201)
    const turnBody = turnResponse.json()
    writeIntegrationArtifact('runtime-tool-turn', turnBody)

    expect(turnBody.turn.status).toBe('complete')
    expect(turnBody.turn.outcome).toBe('tool-assisted-response')
    expect(turnBody.rounds.length).toBeGreaterThan(1)
    expect(turnBody.parts.some((part: { partType: string }) => part.partType === 'tool-call')).toBe(true)
    expect(turnBody.parts.some((part: { partType: string }) => part.partType === 'tool-result')).toBe(true)
    expect(
      turnBody.parts.find((part: { partType: string }) => part.partType === 'user-message')?.tokens?.count,
    ).toBeTypeOf('number')
    expect(
      turnBody.parts.find((part: { partType: string }) => part.partType === 'tool-call')?.tokens?.count,
    ).toBeTypeOf('number')
    expect(
      turnBody.parts.find((part: { partType: string }) => part.partType === 'tool-result')?.tokens?.count,
    ).toBeTypeOf('number')

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    const traceBody = traceResponse.json()
    writeIntegrationArtifact('runtime-tool-trace', traceBody)

    const transcript = traceBody.transcript as Array<{ type: string; text: string | null }>
    expect(transcript.some(entry => entry.type === 'tool-call')).toBe(true)
    expect(transcript.some(entry => entry.type === 'tool-result')).toBe(true)
    expect(transcript.some(entry => entry.type === 'assistant-content' && (entry.text ?? '').trim().length > 0)).toBe(true)

    const context = traceBody.context as Array<{ type: string; tokens: { count: number | null } }>
    expect(
      context.filter(entry => (
        entry.type === 'system-prompt'
        || entry.type === 'mcp-instructions'
        || entry.type === 'tool-definitions'
      )),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'system-prompt', tokens: expect.objectContaining({ count: expect.any(Number) }) }),
        expect.objectContaining({ type: 'mcp-instructions', tokens: expect.objectContaining({ count: expect.any(Number) }) }),
        expect.objectContaining({ type: 'tool-definitions', tokens: expect.objectContaining({ count: expect.any(Number) }) }),
      ]),
    )
  }, 120_000)

  it('handles a multi-turn outdoor-temperature analysis scenario with multi-round tool use and token attribution', async () => {
    const env = getIntegrationEnv()
    const outdoorEntityId = 'sensor.ruuvitag_fc8f_temperature'

    app = await buildBackendApp({
      host: '127.0.0.1',
      port: 3030,
      corsOrigin: true,
      dataDir: '.tmp-test-data',
      sqlitePath,
      maxToolRounds: 10,
    })

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Live temperature multi-turn integration',
        modelProfileSnapshot: {
          id: 'integration-model-temperature',
          name: 'Integration Model Temperature',
          connectionBaseUrl: env.lmStudioBaseUrl,
          apiKey: env.lmStudioApiKey,
          modelKey: env.lmStudioModel,
          modelDisplayName: env.lmStudioModel,
          systemPrompt: 'Use the available tools when they can answer directly. For compound analysis questions, batch independent tool queries into the same assistant tool-call message whenever possible. Avoid exploratory retries or serial tool loops unless a later call truly depends on an earlier result.',
          temperature: 0,
          reasoning: 'on',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        mcpProfileSnapshots: [{
          id: 'integration-mcp-temperature',
          name: 'Local MCP Temperature',
          url: env.mcpServerUrl,
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      },
    })

    expect(sessionResponse.statusCode).toBe(201)
    const sessionId = sessionResponse.json().session.id as string

    const turnOneResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        userContent: [
          `Using the outdoor temperature sensor ${outdoorEntityId}, answer both of these for 2026:`,
          '1. What was the coldest day in January?',
          '2. How many February days had a daily minimum below 0 C?',
          'Make the January and February tool calls in the same tool round before answering, then state the sensor and periods used.',
        ].join(' '),
      },
    })

    expect(turnOneResponse.statusCode).toBe(201)
    const turnOneBody = turnOneResponse.json()
    writeIntegrationArtifact('runtime-temperature-turn-1', turnOneBody)

    expect(turnOneBody.turn.status).toBe('complete')
    expect(turnOneBody.turn.outcome).toBe('tool-assisted-response')
    expect(turnOneBody.turn.usage.totalTokens).toBe(
      turnOneBody.turn.usage.promptTokens + turnOneBody.turn.usage.completionTokens,
    )
    expect(turnOneBody.rounds.length).toBeGreaterThan(1)
    expect(promptBearingParts(turnOneBody.parts).every((part: { tokens?: { count: number | null } }) => typeof part.tokens?.count === 'number')).toBe(true)
    expect(maxToolCallsPerRound(turnOneBody.parts)).toBeGreaterThan(1)

    const turnTwoResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        userContent: [
          `Using the same outdoor temperature sensor ${outdoorEntityId} and keeping the prior context, answer both of these for 2026:`,
          '1. How many March days had a daily minimum below 0 C?',
          '2. How many April days had a daily minimum below 0 C?',
          'Make the March and April tool calls in the same tool round before answering, then state which month had more negative-temperature days.',
        ].join(' '),
      },
    })

    expect(turnTwoResponse.statusCode).toBe(201)
    const turnTwoBody = turnTwoResponse.json()
    writeIntegrationArtifact('runtime-temperature-turn-2', turnTwoBody)

    expect(turnTwoBody.turn.status).toBe('complete')
    expect(turnTwoBody.turn.outcome).toBe('tool-assisted-response')
    expect(turnTwoBody.turn.usage.totalTokens).toBe(
      turnTwoBody.turn.usage.promptTokens + turnTwoBody.turn.usage.completionTokens,
    )
    expect(turnTwoBody.rounds.length).toBeGreaterThan(1)
    expect(promptBearingParts(turnTwoBody.parts).every((part: { tokens?: { count: number | null } }) => typeof part.tokens?.count === 'number')).toBe(true)
    expect(turnTwoBody.parts.some((part: { partType: string }) => part.partType === 'tool-call')).toBe(true)
    expect(turnTwoBody.parts.some((part: { partType: string }) => part.partType === 'tool-result')).toBe(true)

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    const traceBody = traceResponse.json()
    writeIntegrationArtifact('runtime-temperature-trace', traceBody)

    const transcript = traceBody.transcript as Array<{ type: string; text: string | null }>
    expect(transcript.filter(entry => entry.type === 'user-message')).toHaveLength(2)
    expect(transcript.filter(entry => entry.type === 'assistant-content')).toHaveLength(2)
    expect(transcript.filter(entry => entry.type === 'tool-call').length).toBeGreaterThanOrEqual(4)
    expect(transcript.filter(entry => entry.type === 'tool-result').length).toBeGreaterThanOrEqual(4)

    const context = traceBody.context as Array<{ type: string; tokens: { count: number | null } }>
    expect(
      context.filter(entry => (
        entry.type === 'system-prompt'
        || entry.type === 'mcp-instructions'
        || entry.type === 'tool-definitions'
      )),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'system-prompt', tokens: expect.objectContaining({ count: expect.any(Number) }) }),
        expect.objectContaining({ type: 'mcp-instructions', tokens: expect.objectContaining({ count: expect.any(Number) }) }),
        expect.objectContaining({ type: 'tool-definitions', tokens: expect.objectContaining({ count: expect.any(Number) }) }),
      ]),
    )
    expect(
      context.filter(entry => (
        entry.type === 'user-message'
        || entry.type === 'tool-call'
        || entry.type === 'tool-result'
      )).every(entry => typeof entry.tokens.count === 'number'),
    ).toBe(true)
    expect(
      Math.max(
        maxToolCallsPerRound(turnOneBody.parts),
        maxToolCallsPerRound(turnTwoBody.parts),
      ),
    ).toBeGreaterThan(1)
  }, 480_000)

  it('handles a higher-cap outdoor-temperature stress scenario without losing token or reasoning integrity', async () => {
    const env = getIntegrationEnv()
    const outdoorEntityId = 'sensor.ruuvitag_fc8f_temperature'

    app = await buildBackendApp({
      host: '127.0.0.1',
      port: 3030,
      corsOrigin: true,
      dataDir: '.tmp-test-data',
      sqlitePath,
      maxToolRounds: 12,
    })

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Live temperature stress integration',
        modelProfileSnapshot: {
          id: 'integration-model-temperature-stress',
          name: 'Integration Model Temperature Stress',
          connectionBaseUrl: env.lmStudioBaseUrl,
          apiKey: env.lmStudioApiKey,
          modelKey: env.lmStudioModel,
          modelDisplayName: env.lmStudioModel,
          systemPrompt: 'Use the available tools when they can answer directly. Keep reasoning concise, batch independent tool queries when possible, and avoid exploratory retries unless a later query truly depends on an earlier result. For larger analysis tasks, it is acceptable to use several tool rounds before answering.',
          temperature: 0,
          reasoning: 'on',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        mcpProfileSnapshots: [{
          id: 'integration-mcp-temperature-stress',
          name: 'Local MCP Temperature Stress',
          url: env.mcpServerUrl,
          transport: 'streamable-http',
          authType: null,
          authValue: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      },
    })

    expect(sessionResponse.statusCode).toBe(201)
    const sessionId = sessionResponse.json().session.id as string

    const turnResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        userContent: [
          `Using the outdoor temperature sensor ${outdoorEntityId}, complete this staged 2026 analysis before answering:`,
          '1. Find the coldest day in January.',
          '2. Count February days with a daily minimum below 0 C.',
          '3. Count March days with a daily minimum below 0 C.',
          '4. Count April days with a daily minimum below 0 C.',
          '5. Count May days with a daily minimum below 0 C.',
          '6. Determine whether June has enough data to compute the same count.',
          'Prefer to batch independent month queries, but do not guess. If a later comparison depends on confirming earlier results, keep using tools until the analysis is complete.',
          'State the sensor, the periods used, and a month-by-month summary in the final answer.',
        ].join(' '),
      },
    })

    expect(turnResponse.statusCode).toBe(201)
    const turnBody = turnResponse.json()
    writeIntegrationArtifact('runtime-temperature-stress-turn', turnBody)

    expect(turnBody.turn.status).toBe('complete')
    expect(turnBody.turn.outcome).toBe('tool-assisted-response')
    expect(turnBody.turn.usage.totalTokens).toBe(
      turnBody.turn.usage.promptTokens + turnBody.turn.usage.completionTokens,
    )
    expect(promptBearingParts(turnBody.parts).every((part: { tokens?: { count: number | null } }) => typeof part.tokens?.count === 'number')).toBe(true)
    expect(turnBody.parts.filter((part: { partType: string }) => part.partType === 'tool-call').length).toBeGreaterThanOrEqual(6)
    expect(turnBody.parts.filter((part: { partType: string }) => part.partType === 'tool-result').length).toBeGreaterThanOrEqual(6)
    expect(turnBody.parts.filter((part: { partType: string }) => part.partType === 'assistant-reasoning').length).toBeGreaterThanOrEqual(2)

    const traceResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/trace`,
    })
    expect(traceResponse.statusCode).toBe(200)
    const traceBody = traceResponse.json()
    writeIntegrationArtifact('runtime-temperature-stress-trace', traceBody)

    const transcript = traceBody.transcript as Array<{ type: string; text: string | null }>
    expect(transcript.filter(entry => entry.type === 'assistant-content').length).toBeGreaterThanOrEqual(1)
    expect(transcript.filter(entry => entry.type === 'tool-call').length).toBeGreaterThanOrEqual(6)
    expect(transcript.filter(entry => entry.type === 'tool-result').length).toBeGreaterThanOrEqual(6)
    expect(transcript.filter(entry => entry.type === 'assistant-reasoning').length).toBeGreaterThanOrEqual(2)

    const context = traceBody.context as Array<{ type: string; tokens: { count: number | null } }>
    expect(context.some(entry => entry.type === 'assistant-reasoning')).toBe(false)
    expect(
      context.filter(entry => (
        entry.type === 'user-message'
        || entry.type === 'tool-call'
        || entry.type === 'tool-result'
      )).every(entry => typeof entry.tokens.count === 'number'),
    ).toBe(true)
  }, 540_000)
})
