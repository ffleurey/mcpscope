/**
 * Token count sanity tests.
 *
 * These tests verify that token counts are sensible by comparing them against
 * actual part content and checking mathematical consistency across the session:
 *
 *   1. Content ↔ count parity: parts with substantial text/JSON content must
 *      have a non-null, non-zero token count. Parts with no content must not
 *      have suspiciously large counts.
 *
 *   2. Proportionality: for text-bearing parts, chars-per-token must fall
 *      within a generous but realistic range (0.5 – 20). Token counts wildly
 *      out of proportion with content signal a bug in the accounting logic.
 *
 *   3. Turn-level mathematical consistency:
 *      - contextTokensAtTurnEnd  = Σ tokens for (included | round-only) parts
 *                                  + Σ tokens for reasoning parts stripped by
 *                                    THIS turn's compaction
 *      - contextTokensAfterCompaction = Σ tokens for (included | round-only)
 *                                       parts only (after stripping)
 *
 *   4. Monotonic growth: contextTokensAfterCompaction[N] ≤
 *      contextTokensAtTurnEnd[N+1] across consecutive turns — the context
 *      never shrinks unexpectedly between turns.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBackendApp } from '../app.js'
import type { PartRecord, TurnRecord } from '../domain/model.js'
import type { SessionTraceBundle } from '../domain/trace.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSqlitePath() {
  return path.join('.tmp-test-data', `token-sanity-${crypto.randomUUID()}`, 'test.db')
}

/** Rough character count for the payload of a part (text or JSON fallback). */
function payloadCharCount(part: PartRecord): number {
  if (part.payload.text != null && part.payload.text.length > 0) {
    return part.payload.text.length
  }
  if (part.payload.json != null) {
    return JSON.stringify(part.payload.json).length
  }
  return 0
}

/** Label a part for readable test failure messages. */
function partLabel(part: PartRecord): string {
  return `${part.partType}(id=${part.id.slice(0, 8)}, turnId=${part.turnId?.slice(0, 8) ?? 'null'})`
}

// ---------------------------------------------------------------------------
// Core sanity assertions (reusable across fixture scenarios)
// ---------------------------------------------------------------------------

/**
 * Asserts content ↔ count parity and proportionality for every part.
 *
 * Skip diagnostic-note parts — they are display-only and may have arbitrary or
 * missing token counts intentionally.
 */
function assertPartTokenSanity(parts: PartRecord[]): void {
  for (const part of parts) {
    if (part.partType === 'diagnostic-note') continue

    const chars = payloadCharCount(part)
    const count = part.tokens.count
    const label = partLabel(part)

    // Rule 1 — content implies a non-zero count
    if (chars > 10 && (count === null || count === 0)) {
      throw new Error(
        `${label}: has ${chars} content chars but token count is ${count ?? 'null'}. ` +
        `Content: "${(part.payload.text ?? JSON.stringify(part.payload.json) ?? '').slice(0, 60)}"`,
      )
    }

    // Rule 2 — proportionality (only when both count > 0 and chars > 0)
    if (count !== null && count > 0 && chars > 0) {
      const charsPerToken = chars / count
      if (charsPerToken < 0.5 || charsPerToken > 20) {
        throw new Error(
          `${label}: suspicious chars-per-token ratio ${charsPerToken.toFixed(2)} ` +
          `(${chars} chars / ${count} tokens). ` +
          `Content snippet: "${(part.payload.text ?? '').slice(0, 60)}"`,
        )
      }
    }

    // Rule 3 — no content but large count
    if (chars === 0 && count !== null && count > 50) {
      throw new Error(
        `${label}: no payload content but token count is ${count}. ` +
        `This suggests a stale or misattributed count.`,
      )
    }
  }
}

/**
 * Asserts that contextTokensAtTurnEnd and contextTokensAfterCompaction stored
 * on each TurnRecord match what we can compute from the parts in the trace.
 *
 * After compaction, reasoning parts have context.state='stripped' and
 * strippedByCompactionAtTurnId set to the turn that stripped them.
 * To reconstruct the pre-compaction sum we must add those back in.
 */
function assertTurnContextTokenConsistency(turns: TurnRecord[], parts: PartRecord[]): void {
  const sortedTurns = [...turns].sort((a, b) => a.sequenceNumber - b.sequenceNumber)

  // Map turnId → sequenceNumber so we can filter parts by "existed at turn N".
  const seqByTurnId = new Map(turns.map(t => [t.id, t.sequenceNumber]))

  for (const turn of sortedTurns) {
    if (turn.status !== 'complete') continue
    if (turn.contextTokensAtTurnEnd === null) continue

    // A part "existed" at the end of turn N if it was created by turn N or earlier,
    // or is a session-prelude part (turnId null).
    const existedAtTurnN = (p: PartRecord) => {
      if (p.turnId === null) return true
      const partTurnSeq = seqByTurnId.get(p.turnId)
      return partTurnSeq !== undefined && partTurnSeq <= turn.sequenceNumber
    }

    // Parts in context AFTER this turn's compaction (included or round-only).
    const postCompactionParts = parts.filter(
      p => existedAtTurnN(p) && (p.context.state === 'included' || p.context.state === 'round-only'),
    )

    // Parts stripped specifically by THIS turn's compaction.
    const strippedByThisTurn = parts.filter(
      p => p.context.strippedByCompactionAtTurnId === turn.id,
    )

    const postCompactionSum = postCompactionParts.reduce(
      (sum, p) => sum + (p.tokens.count ?? 0), 0,
    )
    const strippedSum = strippedByThisTurn.reduce(
      (sum, p) => sum + (p.tokens.count ?? 0), 0,
    )
    const preCompactionSum = postCompactionSum + strippedSum

    // contextTokensAtTurnEnd must equal the pre-compaction sum.
    expect(
      turn.contextTokensAtTurnEnd,
      `Turn ${turn.sequenceNumber} contextTokensAtTurnEnd mismatch: ` +
      `stored=${turn.contextTokensAtTurnEnd}, ` +
      `computed(post=${postCompactionSum} + stripped=${strippedSum})=${preCompactionSum}`,
    ).toBe(preCompactionSum)

    // contextTokensAfterCompaction must equal the post-compaction sum.
    if (turn.contextTokensAfterCompaction !== null) {
      expect(
        turn.contextTokensAfterCompaction,
        `Turn ${turn.sequenceNumber} contextTokensAfterCompaction mismatch: ` +
        `stored=${turn.contextTokensAfterCompaction}, computed=${postCompactionSum}`,
      ).toBe(postCompactionSum)
    }
  }
}

/**
 * Asserts that context does not shrink between turns.
 *
 * contextTokensAfterCompaction[N] must be ≤ contextTokensAtTurnEnd[N+1]
 * because turn N+1 always adds at least a user message to the context.
 */
function assertMonotonicContextGrowth(turns: TurnRecord[]): void {
  const completed = [...turns]
    .filter(t => t.status === 'complete' && t.contextTokensAtTurnEnd !== null)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)

  for (let i = 0; i < completed.length - 1; i++) {
    const current = completed[i]!
    const next = completed[i + 1]!
    const afterCompaction = current.contextTokensAfterCompaction ?? current.contextTokensAtTurnEnd!

    expect(
      next.contextTokensAtTurnEnd!,
      `Context shrank between turn ${current.sequenceNumber} and ${next.sequenceNumber}: ` +
      `afterCompaction[${current.sequenceNumber}]=${afterCompaction}, ` +
      `atTurnEnd[${next.sequenceNumber}]=${next.contextTokensAtTurnEnd}`,
    ).toBeGreaterThanOrEqual(afterCompaction)
  }
}

// ---------------------------------------------------------------------------
// Mock LM Studio gateway helpers
// ---------------------------------------------------------------------------

/** Mock token counts returned by the model-only LM Studio gateway. */
const SYSTEM_PROMPT_TOKENS = 3  // returned by the first probe
const TURN1_PROMPT_TOKENS = 10  // total prompt for turn 1
const TURN1_COMPLETION_TOKENS = 6
const TURN1_REASONING_TOKENS = 4

/** Probe responses for turn 2 (after turn 1 reasoning is stripped by compaction). */
const TURN2_PROMPT_TOKENS = 22  // turn 1 post-compaction context + user2 message
const TURN2_COMPLETION_TOKENS = 5
const TURN2_REASONING_TOKENS = 2

function makeModelOnlyGateway(turns: 1 | 2) {
  let completionCallCount = 0
  return {
    async probePromptTokensDetailed(_baseUrl: string, _apiKey: string | null, body: Record<string, unknown>) {
      const messages = body.messages as Array<{ role: string }>
      // System-only probe (1 message): returns fixed small count for system prompt.
      if (messages.length === 1) return makeProbeResult(SYSTEM_PROMPT_TOKENS, body)
      // All other probes return a proportional count based on message count.
      return makeProbeResult(messages.length * 4, body)
    },
    async createChatCompletion(_baseUrl: string, _apiKey: string | null, _body: unknown) {
      completionCallCount++
      if (completionCallCount === 1) {
        return {
          id: 'cmpl-1', model: 'model-key', created: 123,
          choices: [{
            index: 0, finish_reason: 'stop',
            message: {
              role: 'assistant',
              reasoning_content: 'Because the answer is simple.',
              content: 'OK',
            },
          }],
          usage: {
            prompt_tokens: TURN1_PROMPT_TOKENS,
            completion_tokens: TURN1_COMPLETION_TOKENS,
            total_tokens: TURN1_PROMPT_TOKENS + TURN1_COMPLETION_TOKENS,
            completion_tokens_details: { reasoning_tokens: TURN1_REASONING_TOKENS },
          },
        }
      }
      if (turns === 2 && completionCallCount === 2) {
        return {
          id: 'cmpl-2', model: 'model-key', created: 124,
          choices: [{
            index: 0, finish_reason: 'stop',
            message: {
              role: 'assistant',
              reasoning_content: 'Fine.',
              content: 'Goodbye.',
            },
          }],
          usage: {
            prompt_tokens: TURN2_PROMPT_TOKENS,
            completion_tokens: TURN2_COMPLETION_TOKENS,
            total_tokens: TURN2_PROMPT_TOKENS + TURN2_COMPLETION_TOKENS,
            completion_tokens_details: { reasoning_tokens: TURN2_REASONING_TOKENS },
          },
        }
      }
      throw new Error(`Unexpected completion call #${completionCallCount}`)
    },
  }
}

function makeProbeResult(promptTokens: number, body: unknown) {
  return {
    promptTokens,
    completion: {
      id: `probe-${promptTokens}`,
      model: 'model-key',
      created: 122,
      choices: [],
      usage: { prompt_tokens: promptTokens, completion_tokens: 0, total_tokens: promptTokens },
    },
    rawExchange: {
      requestUrl: 'https://example.com/v1/chat/completions',
      requestMethod: 'POST',
      requestHeadersJson: { 'Content-Type': 'application/json', Accept: 'application/json' },
      requestBody: JSON.stringify(body),
      responseStatus: 200,
      responseHeadersJson: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ id: `probe-${promptTokens}`, usage: { prompt_tokens: promptTokens } }),
    },
  }
}

const noopMcpGateway = {
  async initializeSession(): Promise<never> { throw new Error('not used') },
  async listTools(): Promise<never> { throw new Error('not used') },
  async callTool(): Promise<never> { throw new Error('not used') },
}

const modelProfileSnapshot = {
  id: 'model-1', name: 'Model',
  connectionBaseUrl: 'https://example.com/v1',
  apiKey: null, modelKey: 'model-key',
  modelDisplayName: 'Model Key',
  systemPrompt: 'Reply exactly.',
  temperature: 0, reasoning: 'on',
  createdAt: 1, updatedAt: 1,
}

async function captureModelOnlyTrace(userInputs: string[]): Promise<SessionTraceBundle> {
  const sqlitePath = makeSqlitePath()
  const app = await buildBackendApp(
    {
      host: '127.0.0.1', port: 3030, corsOrigin: true,
      dataDir: path.dirname(sqlitePath), sqlitePath, maxToolRounds: 5,
    },
    {
      lmStudioGateway: makeModelOnlyGateway(userInputs.length as 1 | 2),
      mcpGateway: noopMcpGateway,
    },
  )

  try {
    const sessionRes = await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: { title: 'Token sanity test', modelProfileSnapshot },
    })
    expect(sessionRes.statusCode).toBe(201)
    const sessionId = sessionRes.json().session.id as string

    for (const userContent of userInputs) {
      const turnRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/turns`,
        payload: { userContent },
      })
      expect(turnRes.statusCode).toBe(201)
    }

    const traceRes = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/trace` })
    expect(traceRes.statusCode).toBe(200)
    return traceRes.json() as SessionTraceBundle
  } finally {
    await app.close()
    fs.rmSync(path.dirname(sqlitePath), { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('token count sanity', () => {
  it('all parts have token counts proportional to their content (single turn)', async () => {
    const trace = await captureModelOnlyTrace(['Say OK.'])
    assertPartTokenSanity(trace.parts)
  })

  it('contextTokensAtTurnEnd matches recomputed part sum (single turn)', async () => {
    const trace = await captureModelOnlyTrace(['Say OK.'])
    assertTurnContextTokenConsistency(trace.turns, trace.parts)
  })

  it('all parts have token counts proportional to their content (two turns)', async () => {
    const trace = await captureModelOnlyTrace(['Say OK.', 'Say bye.'])
    assertPartTokenSanity(trace.parts)
  })

  it('contextTokensAtTurnEnd and contextTokensAfterCompaction are consistent across two turns', async () => {
    const trace = await captureModelOnlyTrace(['Say OK.', 'Say bye.'])
    assertTurnContextTokenConsistency(trace.turns, trace.parts)
  })

  it('context token count grows monotonically across turns', async () => {
    const trace = await captureModelOnlyTrace(['Say OK.', 'Say bye.'])
    assertMonotonicContextGrowth(trace.turns)
  })

  it('stripped reasoning parts account for the compaction token reduction', async () => {
    const trace = await captureModelOnlyTrace(['Say OK.'])
    const [turn] = trace.turns.sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    if (!turn || turn.contextTokensAtTurnEnd === null) return

    const strippedByThisTurn = trace.parts.filter(
      p => p.context.strippedByCompactionAtTurnId === turn.id,
    )
    const strippedSum = strippedByThisTurn.reduce((s, p) => s + (p.tokens.count ?? 0), 0)

    expect(turn.compactionTokensRemoved).toBe(strippedSum)
    expect(turn.contextTokensAfterCompaction).toBe(turn.contextTokensAtTurnEnd - strippedSum)
  })
})
