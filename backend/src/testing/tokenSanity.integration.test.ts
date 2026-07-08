/**
 * Token count sanity — integration tests against live LM Studio.
 *
 * These tests run the same mathematical sanity assertions as tokenSanity.test.ts
 * but against REAL token counts returned by LM Studio. No mocking.
 *
 * Run with:
 *   npx vitest run --config vitest.integration.config.ts
 *
 * Requires .env.dev with LMSTUDIO_BASE_URL, LMSTUDIO_API_KEY, LMSTUDIO_MODEL.
 * MCP_SERVER_URL is required for the tool-enabled scenario.
 */

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildBackendApp } from '../app.js'
import type { PartRecord, TurnRecord } from '../domain/model.js'
import type { SessionTraceBundle } from '../domain/trace.js'
import { getIntegrationEnv } from './integrationEnv.js'
import { writeIntegrationArtifact } from './artifacts.js'

// ---------------------------------------------------------------------------
// Sanity assertion helpers (same logic as tokenSanity.test.ts)
// ---------------------------------------------------------------------------

function payloadCharCount(part: PartRecord): number {
  if (part.payload.text != null && part.payload.text.length > 0) return part.payload.text.length
  if (part.payload.json != null) return JSON.stringify(part.payload.json).length
  return 0
}

function partLabel(part: PartRecord): string {
  return `${part.partType}(id=${part.id.slice(0, 8)}, turn=${part.turnId?.slice(0, 8) ?? 'null'})`
}

function assertPartTokenSanity(parts: PartRecord[]): void {
  for (const part of parts) {
    if (part.partType === 'diagnostic-note') continue

    // tool-call parts: payload.json is our internal representation of the tool call,
    // not the raw tokens the model produced. LM Studio also does not count assistant
    // tool-call messages reliably in probes (returns the same token count before and
    // after the message is appended). Skip content↔count checks for these parts.
    if (part.partType === 'tool-call') continue

    const chars = payloadCharCount(part)
    const count = part.tokens.count
    const label = partLabel(part)

    if (chars > 10 && (count === null || count === 0)) {
      throw new Error(
        `${label}: has ${chars} content chars but token count is ${count ?? 'null'}. ` +
        `Content: "${(part.payload.text ?? JSON.stringify(part.payload.json) ?? '').slice(0, 80)}"`,
      )
    }

    if (count !== null && count > 0 && chars > 0) {
      const charsPerToken = chars / count
      const isJsonPart = part.payload.text == null && part.payload.json != null
      const maxRatio = isJsonPart ? 40 : 20
      if (charsPerToken < 0.5 || charsPerToken > maxRatio) {
        throw new Error(
          `${label}: suspicious chars-per-token ratio ${charsPerToken.toFixed(2)} ` +
          `(${chars} chars / ${count} tokens, ${isJsonPart ? 'JSON' : 'text'} payload). ` +
          `Content: "${(part.payload.text ?? '').slice(0, 80)}"`,
        )
      }
    }

    if (chars === 0 && count !== null && count > 50) {
      throw new Error(`${label}: no payload content but token count is ${count}`)
    }
  }
}

function assertTurnContextTokenConsistency(turns: TurnRecord[], parts: PartRecord[]): void {
  const seqByTurnId = new Map(turns.map(t => [t.id, t.turnNumber]))

  for (const turn of [...turns].sort((a, b) => a.turnNumber - b.turnNumber)) {
    if (turn.status !== 'complete' || turn.contextTokensAtTurnEnd === null) continue

    const existedAtTurnN = (p: PartRecord) => {
      if (p.turnId === null) return true
      const seq = seqByTurnId.get(p.turnId)
      return seq !== undefined && seq <= turn.turnNumber
    }

    const postCompactionParts = parts.filter(
      p => existedAtTurnN(p) && (p.context.state === 'included' || p.context.state === 'round-only'),
    )
    const strippedByThisTurn = parts.filter(p => p.context.strippedByCompactionAtTurnId === turn.id)

    const postSum = postCompactionParts.reduce((s, p) => s + (p.tokens.count ?? 0), 0)
    const strippedSum = strippedByThisTurn.reduce((s, p) => s + (p.tokens.count ?? 0), 0)
    const preSum = postSum + strippedSum

    expect(
      turn.contextTokensAtTurnEnd,
      `Turn ${turn.turnNumber} contextTokensAtTurnEnd: stored=${turn.contextTokensAtTurnEnd}, ` +
      `computed(post=${postSum}+stripped=${strippedSum})=${preSum}`,
    ).toBe(preSum)

    if (turn.contextTokensAfterCompaction !== null) {
      expect(
        turn.contextTokensAfterCompaction,
        `Turn ${turn.turnNumber} contextTokensAfterCompaction: stored=${turn.contextTokensAfterCompaction}, computed=${postSum}`,
      ).toBe(postSum)
    }
  }
}

function assertMonotonicContextGrowth(turns: TurnRecord[]): void {
  const completed = [...turns]
    .filter(t => t.status === 'complete' && t.contextTokensAtTurnEnd !== null)
    .sort((a, b) => a.turnNumber - b.turnNumber)

  for (let i = 0; i < completed.length - 1; i++) {
    const cur = completed[i]!
    const next = completed[i + 1]!
    const afterCompaction = cur.contextTokensAfterCompaction ?? cur.contextTokensAtTurnEnd!
    expect(
      next.contextTokensAtTurnEnd!,
      `Context shrank: afterCompaction[turn ${cur.turnNumber}]=${afterCompaction}, ` +
      `atTurnEnd[turn ${next.turnNumber}]=${next.contextTokensAtTurnEnd}`,
    ).toBeGreaterThanOrEqual(afterCompaction)
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('token count sanity — live LM Studio integration', () => {
  let app: FastifyInstance | undefined
  const sqlitePath = path.join('.tmp-test-data', 'token-sanity-integration.db')

  afterEach(async () => {
    await app?.close()
    app = undefined
    fs.rmSync('.tmp-test-data', { recursive: true, force: true })
  })

  it('model-only single turn: part token counts are proportional to content', async () => {
    const env = getIntegrationEnv()
    app = await buildBackendApp(
      { host: '127.0.0.1', port: 3066, corsOrigin: true, dataDir: '.tmp-test-data', sqlitePath, maxToolRounds: 5 },
    )

    const sessionRes = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: {
        title: 'Token sanity — model-only single turn',
        modelProfileSnapshot: {
          id: 'ts-model', name: 'Token Sanity Model',
          connectionBaseUrl: env.lmStudioBaseUrl,
          apiKey: env.lmStudioApiKey,
          modelKey: env.lmStudioModel,
          modelDisplayName: env.lmStudioModel,
          systemPrompt: 'Reply with the exact text: OK',
          temperature: 0, reasoning: 'on',
          createdAt: Date.now(), updatedAt: Date.now(),
        },
      },
    })
    expect(sessionRes.statusCode).toBe(201)
    const sessionId = sessionRes.json().session.id as string

    const turnRes = await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/turns`,
      payload: { userContent: 'Say OK.' },
    })
    expect(turnRes.statusCode).toBe(201)

    const traceRes = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/trace` })
    expect(traceRes.statusCode).toBe(200)
    const trace = traceRes.json() as SessionTraceBundle
    writeIntegrationArtifact('token-sanity-model-only-single', trace)

    assertPartTokenSanity(trace.parts)
    assertTurnContextTokenConsistency(trace.turns, trace.parts)
  }, 120_000)

  it('model-only two turns: context sums are consistent and grow monotonically', async () => {
    const env = getIntegrationEnv()
    app = await buildBackendApp(
      { host: '127.0.0.1', port: 3066, corsOrigin: true, dataDir: '.tmp-test-data', sqlitePath, maxToolRounds: 5 },
    )

    const sessionRes = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: {
        title: 'Token sanity — model-only two turns',
        modelProfileSnapshot: {
          id: 'ts-model-2', name: 'Token Sanity Model 2',
          connectionBaseUrl: env.lmStudioBaseUrl,
          apiKey: env.lmStudioApiKey,
          modelKey: env.lmStudioModel,
          modelDisplayName: env.lmStudioModel,
          systemPrompt: 'Reply concisely. One sentence maximum.',
          temperature: 0, reasoning: 'on',
          createdAt: Date.now(), updatedAt: Date.now(),
        },
      },
    })
    expect(sessionRes.statusCode).toBe(201)
    const sessionId = sessionRes.json().session.id as string

    for (const msg of ['What is 2+2?', 'And 3+3?']) {
      const r = await app.inject({
        method: 'POST', url: `/api/sessions/${sessionId}/turns`,
        payload: { userContent: msg },
      })
      expect(r.statusCode).toBe(201)
    }

    const traceRes = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/trace` })
    expect(traceRes.statusCode).toBe(200)
    const trace = traceRes.json() as SessionTraceBundle
    writeIntegrationArtifact('token-sanity-model-only-two-turns', trace)

    assertPartTokenSanity(trace.parts)
    assertTurnContextTokenConsistency(trace.turns, trace.parts)
    assertMonotonicContextGrowth(trace.turns)

    // Reasoning parts from turn 1 must be stripped; turn 2 context must not include them.
    const [turn1] = [...trace.turns].sort((a, b) => a.turnNumber - b.turnNumber)
    if (turn1) {
      const stripped = trace.parts.filter(p => p.context.strippedByCompactionAtTurnId === turn1.id)
      expect(stripped.every(p => p.partType === 'assistant-reasoning')).toBe(true)
      expect(turn1.compactionTokensRemoved).toBe(
        stripped.reduce((s, p) => s + (p.tokens.count ?? 0), 0),
      )
    }
  }, 180_000)

  it('tool-enabled two turns: all part types have sensible token counts and sums are consistent', async () => {
    const env = getIntegrationEnv()
    app = await buildBackendApp(
      { host: '127.0.0.1', port: 3066, corsOrigin: true, dataDir: '.tmp-test-data', sqlitePath, maxToolRounds: 5 },
    )

    const sessionRes = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: {
        title: 'Token sanity — tool-enabled two turns',
        modelProfileSnapshot: {
          id: 'ts-model-tool', name: 'Token Sanity Tool Model',
          connectionBaseUrl: env.lmStudioBaseUrl,
          apiKey: env.lmStudioApiKey,
          modelKey: env.lmStudioModel,
          modelDisplayName: env.lmStudioModel,
          systemPrompt: 'Use the available tools when they can answer directly.',
          temperature: 0, reasoning: 'on',
          createdAt: Date.now(), updatedAt: Date.now(),
        },
        mcpProfileSnapshots: [{
          id: 'ts-mcp', name: 'Token Sanity MCP',
          url: env.mcpServerUrl,
          transport: 'streamable-http',
          authType: null, authValue: null,
          createdAt: Date.now(), updatedAt: Date.now(),
        }],
      },
    })
    expect(sessionRes.statusCode).toBe(201)
    const sessionId = sessionRes.json().session.id as string

    for (const msg of [
      'Use the available tool to tell me the current time.',
      'Thanks. What was the time again?',
    ]) {
      const r = await app.inject({
        method: 'POST', url: `/api/sessions/${sessionId}/turns`,
        payload: { userContent: msg },
      })
      expect(r.statusCode).toBe(201)
    }

    const traceRes = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/trace` })
    expect(traceRes.statusCode).toBe(200)
    const trace = traceRes.json() as SessionTraceBundle
    writeIntegrationArtifact('token-sanity-tool-two-turns', trace)

    assertPartTokenSanity(trace.parts)
    assertTurnContextTokenConsistency(trace.turns, trace.parts)
    assertMonotonicContextGrowth(trace.turns)

    // At least one tool-call and tool-result part must be present and included in context.
    const toolParts = trace.parts.filter(
      p => p.partType === 'tool-call' || p.partType === 'tool-result',
    )
    expect(toolParts.length).toBeGreaterThan(0)
    expect(toolParts.every(p => p.context.state === 'included')).toBe(true)

    // tool-result parts must have non-zero token counts (they produce real text).
    // tool-call parts intentionally have token count 0 — LM Studio does not count
    // assistant tool-call messages in probes (returns the same prompt_tokens whether
    // or not the assistant tool-call message is included).
    const toolResultParts = toolParts.filter(p => p.partType === 'tool-result')
    expect(toolResultParts.every(p => p.tokens.count !== null && p.tokens.count > 0)).toBe(true)

    // Reasoning parts from each completed turn must be stripped by compaction.
    for (const turn of trace.turns.filter(t => t.status === 'complete')) {
      const reasoning = trace.parts.filter(
        p => p.partType === 'assistant-reasoning' && p.turnId === turn.id,
      )
      if (reasoning.length > 0) {
        expect(reasoning.every(p => p.context.strippedByCompactionAtTurnId === turn.id)).toBe(true)
      }
    }
  }, 240_000)
})
