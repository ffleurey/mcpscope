import { describe, expect, it } from 'vitest'
import type { PartRecord } from './model.js'
import {
  allocateProportionalTokenCounts,
  deriveExactDeltaTokenMetadata,
  deriveExactUserTokenMetadata,
  normalizeLmStudioUsage,
  normalizeLmStudioUsageFromResponse,
} from './tokenAccounting.js'

function makePart(count: number | null): PartRecord {
  return {
    id: crypto.randomUUID(),
    sessionId: 'session-1',
    turnId: null,
    roundId: null,
    parentPartId: null,
    ordinal: 0,
    partType: 'system-prompt',
    roleLabel: 'system',
    payload: {
      text: 'system',
      json: null,
      mimeType: 'text/plain',
      summary: null,
    },
    display: {
      state: 'diagnostic',
      collapsedByDefault: true,
    },
    context: {
      state: 'included',
      note: null,
      strippedByCompactionAtTurnId: null,
    },
    tokens: {
      count,
      source: count == null ? 'unknown' : 'exact-api',
      confidence: count == null ? 'unknown' : 'exact',
      note: null,
    },
    provenanceJson: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('token accounting', () => {
  it('normalizes reasoning tokens from nested LM Studio usage', () => {
    const usage = normalizeLmStudioUsage({
      prompt_tokens: 26,
      completion_tokens: 152,
      total_tokens: 178,
      completion_tokens_details: {
        reasoning_tokens: 148,
      },
    })

    expect(usage).toEqual({
      promptTokens: 26,
      completionTokens: 152,
      reasoningTokens: 148,
      totalTokens: 178,
      assistantContentTokens: 4,
    })
  })

  it('prefers explicit top-level reasoning tokens when present', () => {
    const usage = normalizeLmStudioUsageFromResponse({
      usage: {
        prompt_tokens: 12,
        completion_tokens: 7,
        total_tokens: 19,
        reasoning_tokens: 5,
        completion_tokens_details: {
          reasoning_tokens: 4,
        },
      },
    })

    expect(usage.reasoningTokens).toBe(5)
    expect(usage.assistantContentTokens).toBe(2)
  })

  it('derives exact user tokens when all included prelude parts are exact', () => {
    const metadata = deriveExactUserTokenMetadata(30, [makePart(12), makePart(8)])
    expect(metadata).toEqual({
      count: 10,
      source: 'delta-derived',
      confidence: 'exact',
      note: 'Derived as prompt_tokens minus exact included prelude token counts',
    })
  })

  it('keeps user tokens unknown when exact prelude counts are missing', () => {
    const metadata = deriveExactUserTokenMetadata(30, [makePart(12), makePart(null)])
    expect(metadata.source).toBe('unknown')
    expect(metadata.count).toBeNull()
  })

  it('derives exact delta token metadata from total and prefix totals', () => {
    expect(
      deriveExactDeltaTokenMetadata(
        30,
        18,
        'Derived from exact round prompt delta',
        'Missing exact prefix prompt total',
      ),
    ).toEqual({
      count: 12,
      source: 'delta-derived',
      confidence: 'exact',
      note: 'Derived from exact round prompt delta',
    })
  })

  it('allocates proportional token counts with deterministic rounding', () => {
    expect(allocateProportionalTokenCounts(10, [3, 2, 1])).toEqual([5, 3, 2])
  })
})
